package studioskills

import (
	"strings"
	"testing"
)

func TestEveryPODAndRetouchToolHasBuiltinSkill(t *testing.T) {
	tools := []string{
		"image_variation",
		"scene_variation",
		"pose_variation",
		"print_extract",
		"virtual_try_on",
		"apparel_set",
		"product_retouch",
		"image_inpaint",
		"image_erase",
	}
	for _, tool := range tools {
		skill, ok := ForTool(tool)
		if !ok {
			t.Fatalf("missing built-in skill for %s", tool)
		}
		if skill.Name == "" || skill.Description == "" {
			t.Fatalf("incomplete metadata for %s", tool)
		}
		if len([]rune(skill.Content)) < 200 {
			t.Fatalf("skill content for %s is unexpectedly short", tool)
		}
		if strings.HasPrefix(skill.Content, "---") {
			t.Fatalf("frontmatter leaked into prompt for %s", tool)
		}
	}
}

func TestSimilarAliasUsesImageVariationSkill(t *testing.T) {
	skill, ok := ForTool("similar")
	if !ok {
		t.Fatal("similar alias did not resolve")
	}
	if skill.Name != "image-variation" {
		t.Fatalf("unexpected skill: %s", skill.Name)
	}
}
