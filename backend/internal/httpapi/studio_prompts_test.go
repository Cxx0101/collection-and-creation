package httpapi

import (
	"strings"
	"testing"
)

func TestOptionalPromptTools(t *testing.T) {
	optional := []string{
		"image_variation",
		"similar",
		"scene_variation",
		"pose_variation",
		"print_extract",
		"virtual_try_on",
		"apparel_set",
		"product_retouch",
		"image_erase",
	}
	for _, tool := range optional {
		if toolRequiresPrompt(tool) {
			t.Fatalf("%s should allow an empty prompt", tool)
		}
	}
	required := []string{"image", "video", "product", "article", "image_inpaint"}
	for _, tool := range required {
		if !toolRequiresPrompt(tool) {
			t.Fatalf("%s should require a prompt", tool)
		}
	}
}

func TestStudioToolAliasesAreAccepted(t *testing.T) {
	for _, tool := range []string{"image_variation", "similar", "product_retouch", "image_inpaint"} {
		if _, ok := toolDisplayNames[tool]; !ok {
			t.Fatalf("missing display name for %s", tool)
		}
	}
}

func TestComposeStudioPromptLoadsBuiltinSkillWithoutUserPrompt(t *testing.T) {
	prompt := composeStudioPrompt("product_retouch", "")
	if !strings.Contains(prompt, "以唯一一张商品原图为编辑底稿") {
		t.Fatal("product retouch skill was not loaded")
	}
	if strings.Contains(prompt, "本次用户补充要求") {
		t.Fatal("empty prompt should not create a user requirement section")
	}
}

func TestComposeImagePromptVariesEachVariation(t *testing.T) {
	base := composeStudioPrompt("image_variation", "")
	first := composeImagePrompt("image_variation", base, map[string]interface{}{}, 0, 1)
	second := composeImagePrompt("image_variation", base, map[string]interface{}{}, 1, 1)
	if first == second {
		t.Fatal("variation prompts should differ by output index")
	}
	if !strings.Contains(first, "母题替换") || !strings.Contains(second, "元素融合") {
		t.Fatal("variation focus was not applied")
	}
}

func TestApparelSetPromptUsesBackAndModelReferences(t *testing.T) {
	params := map[string]interface{}{
		"references": []interface{}{
			map[string]interface{}{"role": "apparel_front"},
			map[string]interface{}{"role": "apparel_back"},
			map[string]interface{}{"role": "apparel_model"},
		},
	}
	prompt := composeImagePrompt("apparel_set", composeStudioPrompt("apparel_set", ""), params, 3, 3)
	if !strings.Contains(prompt, "图 3：模特参考") {
		t.Fatal("reference roles were not included")
	}
	if !strings.Contains(prompt, "背面剪裁") {
		t.Fatal("rear reference did not unlock the rear shot")
	}
	if !strings.Contains(prompt, "同一位模特") {
		t.Fatal("model reference guidance was not included")
	}
}

func TestPrintExtractionPromptHonorsBackground(t *testing.T) {
	transparent := composeImagePrompt("print_extract", "", map[string]interface{}{"printBackground": "transparent"}, 0, 1)
	white := composeImagePrompt("print_extract", "", map[string]interface{}{"printBackground": "white"}, 0, 1)
	if !strings.Contains(transparent, "alpha 通道") || !strings.Contains(white, "纯白背景") {
		t.Fatal("print extraction background guidance is incorrect")
	}
}
