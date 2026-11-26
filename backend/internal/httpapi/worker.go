package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"sparkstudio/backend/internal/models"
	"sparkstudio/backend/internal/tikhub"
)

var (
	studioScanning     atomic.Bool
	collectionScanning atomic.Bool
	workflowScanning   atomic.Bool
	studioSlots        = make(chan struct{}, 2)
)

func (s *Server) StartWorkers(ctx context.Context) {
	s.recoverCollectionJobs()
	go s.collectionWorkerLoop(ctx)
	go s.studioWorkerLoop(ctx)
	go s.workflowSchedulerLoop(ctx)
}

func (s *Server) recoverCollectionJobs() {
	s.DB.Model(&models.CollectionBatch{}).
		Where("status = ?", "running").
		Update("status", "queued")
}

func (s *Server) collectionWorkerLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !collectionScanning.CompareAndSwap(false, true) {
				continue
			}
			go func() {
				defer collectionScanning.Store(false)
				s.claimCollectionJobs(ctx)
			}()
		}
	}
}

func (s *Server) claimCollectionJobs(ctx context.Context) {
	var batches []models.CollectionBatch
	s.DB.Where("status = ?", "queued").Order("id asc").Limit(3).Find(&batches)
	for _, batch := range batches {
		res := s.DB.Model(&models.CollectionBatch{}).
			Where("id = ? AND status = ?", batch.ID, "queued").
			Update("status", "running")
		if res.Error != nil || res.RowsAffected == 0 {
			continue
		}
		batchID := batch.ID
		go func() {
			runCtx, cancel := context.WithTimeout(ctx, 12*time.Minute)
			defer cancel()
			s.processCollectionBatch(runCtx, batchID)
		}()
	}
}

func (s *Server) processCollectionBatch(ctx context.Context, batchID uint) {
	var batch models.CollectionBatch
	if err := s.DB.First(&batch, batchID).Error; err != nil {
		return
	}
	var tk models.TikhubConfig
	s.DB.First(&tk)
	if !tk.Enabled {
		if !appIsDev() {
			s.failCollection(batchID, "后台尚未启用 TikHub 采集通道")
			return
		}
		time.Sleep(500 * time.Millisecond)
		req := createBatchReq{
			Platform: batch.Platform, Keyword: batch.Keyword, Pages: batch.Pages,
			Limit: batch.Limit, ContentType: batch.ContentType, Days: batch.PublishedDays,
		}
		items := buildCollectionItems(batch.OwnerUserID, batch.ID, req)
		pages := batch.Pages
		if pages < 1 {
			pages = 1
		}
		nowMode := "demo"
		if err := s.finishCollection(batchID, items, pages, nowMode); err != nil {
			s.failCollection(batchID, "示例采集落库失败："+err.Error())
		}
		return
	}

	client, err := tikhub.New(tikhub.Config{
		BaseURL: tk.BaseURL, APIKey: decryptSecret(tk.APIKey), ProxyURL: tk.ProxyURL,
	})
	if err != nil {
		s.failCollection(batchID, err.Error())
		return
	}
	limit := batch.Limit
	if limit < 1 {
		limit = 40
	}
	if limit > batch.Pages*40 {
		limit = batch.Pages * 40
	}
	result, err := client.Search(ctx, batch.Platform, batch.Keyword, batch.Pages, limit, batch.ContentType, batch.PublishedDays)
	if err != nil {
		s.failCollection(batchID, err.Error())
		return
	}
	if result.Items, err = s.persistCollectionCovers(ctx, batch, result.Items); err != nil {
		s.failCollection(batchID, "采集封面转存失败："+err.Error())
		return
	}
	items := make([]models.CollectionItem, 0, len(result.Items))
	for i, item := range result.Items {
		metrics, _ := json.Marshal(item.Metrics)
		raw, _ := json.Marshal(item.Raw)
		if len(raw) > 4<<20 {
			raw = []byte(`{"truncated":true}`)
		}
		items = append(items, models.CollectionItem{
			BatchID: batch.ID, OwnerUserID: batch.OwnerUserID, Platform: batch.Platform,
			ExternalID: item.ExternalID, Title: item.Title, Description: item.Description,
			Author: item.Author, Heat: item.Heat, URL: item.URL, CoverURL: item.CoverURL,
			MediaURL: item.MediaURL, ContentType: item.ContentType, Duration: item.Duration,
			PublishedAt: item.PublishedAt, MetricsJSON: string(metrics), RawJSON: string(raw),
			Seed: i % 6, Saved: true,
		})
	}
	if err := s.finishCollection(batchID, items, result.PagesFetched, "tikhub"); err != nil {
		s.failCollection(batchID, "采集结果落库失败："+err.Error())
	}
}

func (s *Server) persistCollectionCovers(ctx context.Context, batch models.CollectionBatch, items []tikhub.Item) ([]tikhub.Item, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	for index := range items {
		coverURL := strings.TrimSpace(items[index].CoverURL)
		if coverURL == "" || len(items[index].ExternalID) == 0 {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, coverURL, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if readErr != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 || len(raw) == 0 {
			continue
		}
		ext := extensionForMIME(resp.Header.Get("Content-Type"), coverURL)
		key := newObjectKey(fmt.Sprintf("collection/%d/covers", batch.ID), ext)
		if err := s.putObject(ctx, key, bytes.NewReader(raw), int64(len(raw)), resp.Header.Get("Content-Type")); err != nil {
			continue
		}
		items[index].CoverURL = s.objectURL(key)
	}
	return items, nil
}

func (s *Server) finishCollection(batchID uint, items []models.CollectionItem, pages int, mode string) error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var batch models.CollectionBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, batchID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if batch.CreditsSettled || batch.Status == "cancelled" {
			return nil
		}
		if pages < 0 {
			pages = 0
		}
		unit := creditsPerPageForBatch(tx, batch.Platform)
		actual := int64(pages) * unit
		if actual > batch.CreditsCharged {
			actual = batch.CreditsCharged
		}
		sort.SliceStable(items, func(i, j int) bool { return items[i].Heat > items[j].Heat })
		if len(items) > 0 {
			if err := tx.Create(&items).Error; err != nil {
				return err
			}
		}
		detail, _ := json.Marshal(map[string]interface{}{
			"platform": batch.Platform, "pagesFetched": pages, "unitCredits": unit,
			"keyword": batch.Keyword, "itemCount": len(items), "mode": mode,
		})
		if batch.CreditsCharged > 0 {
			if err := s.settleCredits(tx, batch.OwnerUserID, batch.CreditsCharged, actual, "tikhub_collect", fmt.Sprint(batch.ID), fmt.Sprintf("%s采集 %d 页", collectionPlatformNames[batch.Platform], pages), string(detail)); err != nil {
				return err
			}
		}
		return tx.Model(&batch).Updates(map[string]interface{}{
			"status": "succeeded", "pages_fetched": pages, "credits_charged": actual,
			"credits_settled": true, "item_count": len(items), "mode": mode, "error_message": "",
		}).Error
	})
}

func (s *Server) failCollection(batchID uint, message string) {
	message = truncateRunes(message, 700)
	_ = s.DB.Transaction(func(tx *gorm.DB) error {
		var batch models.CollectionBatch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&batch, batchID).Error; err != nil {
			return nil
		}
		if batch.CreditsSettled {
			return nil
		}
		if batch.CreditsCharged > 0 {
			if err := s.refundReserved(tx, batch.OwnerUserID, batch.CreditsCharged, "tikhub_collect", fmt.Sprint(batch.ID), "采集失败，全额退回预冻结积分"); err != nil {
				return err
			}
		}
		return tx.Model(&batch).Updates(map[string]interface{}{
			"status": "failed", "credits_charged": 0, "credits_settled": true,
			"error_message": message,
		}).Error
	})
}

func creditsPerPageForBatch(tx *gorm.DB, platform string) int64 {
	var tk models.TikhubConfig
	tx.First(&tk)
	return creditsPerPage(tk, platform)
}

func extensionForMIME(contentType, sourceURL string) string {
	if extensions, err := mime.ExtensionsByType(strings.Split(contentType, ";")[0]); err == nil && len(extensions) > 0 {
		return extensions[0]
	}
	ext := strings.ToLower(path.Ext(sourceURL))
	if ext != "" && len(ext) <= 6 {
		return ext
	}
	return ".jpg"
}
