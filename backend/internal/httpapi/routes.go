package httpapi

import "github.com/gin-gonic/gin"

func (s *Server) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api/v1")
	{
		api.GET("/health", func(c *gin.Context) { OK(c, gin.H{"status": "ok"}) })
		api.GET("/public/config", s.PublicConfig)
		api.GET("/media/*key", s.MediaFile)

		auth := api.Group("/auth")
		{
			auth.POST("/register", s.Register)
			auth.POST("/login", s.Login)
			auth.POST("/send-code", s.SendCode)
		}

		api.GET("/credit/packages", s.ListPublicPackages)

		pay := api.Group("/payments")
		{
			pay.POST("/alipay/notify", s.AlipayNotify)
			pay.POST("/wechat/notify", s.WechatNotify)
			pay.POST("/fyepay/notify", s.FyepayNotify)
		}

		authed := api.Group("")
		authed.Use(s.AuthRequired())
		{
			authed.GET("/me", s.Me)
			authed.PATCH("/me", s.UpdateMe)
			authed.POST("/me/password", s.ChangePassword)
			authed.GET("/me/summary", s.MeSummary)

			authed.GET("/models/catalog", s.ModelCatalog)

			authed.GET("/credit/orders", s.ListMyOrders)
			authed.POST("/credit/orders", s.CreateOrder)
			authed.GET("/credit/orders/:orderNo", s.GetMyOrder)
			authed.POST("/credit/orders/:orderNo/mock-pay", s.MockPayOrder)
			authed.GET("/credit/ledger", s.ListMyLedger)

			authed.GET("/assets", s.ListAssets)
			authed.POST("/assets", s.CreateAssetRecord)
			authed.POST("/assets/upload", s.UploadAsset)
			authed.DELETE("/assets/:id", s.DeleteAsset)
			authed.POST("/assets/batch-delete", s.BatchDeleteAssets)
			authed.GET("/assets/zip", s.DownloadAssetsZip)

			authed.GET("/products", s.ListProducts)
			authed.POST("/products", s.CreateProduct)
			authed.PUT("/products/:id", s.UpdateProduct)
			authed.DELETE("/products/:id", s.DeleteProduct)

			authed.GET("/collection/batches", s.ListBatches)
			authed.POST("/collection/batches", s.CreateBatch)
			authed.GET("/collection/batches/:id/items", s.ListBatchItems)
			authed.DELETE("/collection/batches/:id", s.DeleteBatch)
			authed.GET("/collection/items", s.ListAllItems)
			authed.DELETE("/collection/items/:id", s.DeleteItem)
			authed.POST("/collection/ai-keywords", s.AIKeywords)
			authed.GET("/collection/keywords", s.ListCollectionKeywords)
			authed.POST("/collection/keywords", s.CreateCollectionKeyword)
			authed.DELETE("/collection/keywords/:id", s.DeleteCollectionKeyword)

			authed.GET("/studio/jobs", s.ListStudioJobs)
			authed.POST("/studio/jobs", s.CreateStudioJob)
			authed.GET("/studio/jobs/:id", s.GetStudioJob)
			authed.DELETE("/studio/jobs/:id", s.DeleteStudioJob)

			authed.GET("/skills", s.ListSkills)
			authed.POST("/skills", s.CreateSkill)
			authed.PUT("/skills/:id", s.UpdateSkill)
			authed.DELETE("/skills/:id", s.DeleteSkill)

			authed.GET("/workflows", s.ListWorkflows)
			authed.POST("/workflows", s.CreateWorkflow)
			authed.PUT("/workflows/:id", s.UpdateWorkflow)
			authed.DELETE("/workflows/:id", s.DeleteWorkflow)
			authed.POST("/workflows/:id/run", s.RunWorkflow)

			authed.GET("/profile/providers", s.ListUserProviders)
			authed.POST("/profile/providers", s.CreateUserProvider)
			authed.POST("/profile/providers/remote-models", s.ListUserRemoteModels)
			authed.PUT("/profile/providers/:id", s.UpdateUserProvider)
			authed.DELETE("/profile/providers/:id", s.DeleteUserProvider)

			authed.GET("/profile/wechats", s.ListWechats)
			authed.POST("/profile/wechats", s.CreateWechat)
			authed.PUT("/profile/wechats/:id", s.UpdateWechat)
			authed.DELETE("/profile/wechats/:id", s.DeleteWechat)
			authed.GET("/profile/egress-ip", s.EgressIP)

			authed.GET("/clone/drafts", s.ListCloneDrafts)
			authed.POST("/clone/drafts", s.CreateCloneDraft)
			authed.PUT("/clone/drafts/:id", s.UpdateCloneDraft)
			authed.DELETE("/clone/drafts/:id", s.DeleteCloneDraft)
			authed.POST("/clone/analyze", s.AnalyzeClone)
			authed.POST("/clone/render", s.RenderClone)
		}

		admin := api.Group("/admin")
		admin.Use(s.AuthRequired(), s.AdminRequired())
		{
			admin.GET("/stats", s.AdminStats)
			admin.GET("/trend", s.AdminTrend)
			admin.GET("/users", s.AdminListUsers)
			admin.POST("/users", s.AdminCreateUser)
			admin.PATCH("/users/:id", s.AdminUpdateUser)
			admin.DELETE("/users/:id", s.AdminDeleteUser)
			admin.POST("/users/:id/credits", s.AdminAdjustCredits)
			admin.POST("/users/:id/reset-password", s.AdminResetPassword)

			admin.GET("/packages", s.AdminListPackages)
			admin.POST("/packages", s.AdminCreatePackage)
			admin.PUT("/packages/:id", s.AdminUpdatePackage)
			admin.DELETE("/packages/:id", s.AdminDeletePackage)
			admin.GET("/orders", s.AdminListOrders)
			admin.POST("/orders/:id/mark-paid", s.AdminMarkPaid)

			admin.GET("/settings", s.AdminGetSettings)
			admin.PUT("/settings", s.AdminUpdateSettings)
			admin.GET("/providers", s.AdminListProviders)
			admin.POST("/providers", s.AdminCreateProvider)
			admin.PUT("/providers/:id", s.AdminUpdateProvider)
			admin.DELETE("/providers/:id", s.AdminDeleteProvider)
			admin.POST("/providers/:id/models", s.AdminCreateModel)
			admin.PUT("/providers/:id/models/:modelId", s.AdminUpdateModel)
			admin.DELETE("/providers/:id/models/:modelId", s.AdminDeleteModel)
			admin.GET("/providers/:id/remote-models", s.AdminListRemoteModels)
			admin.POST("/providers/:id/test", s.AdminTestProvider)
			admin.GET("/storage", s.AdminGetStorage)
			admin.PUT("/storage", s.AdminUpdateStorage)
			admin.POST("/storage/test", s.AdminTestStorage)
			admin.GET("/tikhub", s.AdminGetTikhub)
			admin.PUT("/tikhub", s.AdminUpdateTikhub)
			admin.POST("/tikhub/test", s.AdminTestTikhub)
			admin.GET("/jobs", s.AdminListJobs)
			admin.POST("/jobs/:id/cancel", s.AdminCancelJob)
			admin.GET("/ledger", s.AdminListLedger)
		}
	}
}
