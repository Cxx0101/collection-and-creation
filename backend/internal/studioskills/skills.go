package studioskills

import (
	"embed"
	"fmt"
	"strings"
	"sync"
)

//go:embed *.md
var markdown embed.FS

type Skill struct {
	Tool        string
	Name        string
	Description string
	Content     string
}

type definition struct {
	tool        string
	name        string
	description string
	file        string
}

var definitions = []definition{
	{
		tool:        "image_variation",
		name:        "image-variation",
		description: "POD · 解构参考素材的形态、线条、色彩、构图与质感，生成有明显变化且保持系列感的独立新图",
		file:        "image-variation.md",
	},
	{
		tool:        "scene_variation",
		name:        "scene-variation",
		description: "POD · 保留商品真实外观、结构与标识，生成符合实际用途的新电商场景图",
		file:        "scene-variation.md",
	},
	{
		tool:        "pose_variation",
		name:        "pose-variation",
		description: "POD · 保留同一人物、服装、场景和拍摄风格，生成自然且差异明确的新姿势",
		file:        "pose-variation.md",
	},
	{
		tool:        "print_extract",
		name:        "print-extraction",
		description: "POD · 从商品实拍中剥离印花，校正透视与曲面变形，输出白底或透明底平面整理稿",
		file:        "print-extraction.md",
	},
	{
		tool:        "virtual_try_on",
		name:        "virtual-try-on",
		description: "POD · 将服装参考自然试穿到人物参考，保留人物身份、姿势、背景与服装设计细节",
		file:        "virtual-try-on.md",
	},
	{
		tool:        "apparel_set",
		name:        "apparel-set",
		description: "POD · 以同一件服装生成主图、版型、侧面、细节、平铺与模特展示等统一风格套图",
		file:        "apparel-set.md",
	},
	{
		tool:        "product_retouch",
		name:        "product-retouch",
		description: "商业修图 · 精修商品实拍的光影、材质、色彩与瑕疵，严格保留商品真实外观和品牌信息",
		file:        "product-retouch.md",
	},
	{
		tool:        "image_inpaint",
		name:        "image-inpaint",
		description: "商业修图 · 根据画笔标记和修改要求局部重绘，保持原图构图、画幅和未标记区域不变",
		file:        "image-inpaint.md",
	},
	{
		tool:        "image_erase",
		name:        "image-erase",
		description: "商业修图 · 无痕移除画笔标记内的物体、水印或杂物，并按周围纹理自然补全背景",
		file:        "image-erase.md",
	},
}

var (
	loadOnce sync.Once
	catalog  []Skill
)

func load() {
	catalog = make([]Skill, 0, len(definitions))
	for _, item := range definitions {
		raw, err := markdown.ReadFile(item.file)
		if err != nil {
			panic(fmt.Sprintf("read built-in studio skill %s: %v", item.file, err))
		}
		catalog = append(catalog, Skill{
			Tool:        item.tool,
			Name:        item.name,
			Description: item.description,
			Content:     stripFrontmatter(string(raw)),
		})
	}
}

func All() []Skill {
	loadOnce.Do(load)
	result := make([]Skill, len(catalog))
	copy(result, catalog)
	return result
}

func ForTool(tool string) (Skill, bool) {
	loadOnce.Do(load)
	canonical := strings.TrimSpace(tool)
	if canonical == "similar" {
		canonical = "image_variation"
	}
	for _, item := range catalog {
		if item.Tool == canonical {
			return item, true
		}
	}
	return Skill{}, false
}

func stripFrontmatter(value string) string {
	const delimiter = "---"
	text := strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
	if !strings.HasPrefix(text, delimiter+"\n") {
		return text
	}
	rest := strings.TrimPrefix(text, delimiter+"\n")
	index := strings.Index(rest, "\n"+delimiter)
	if index < 0 {
		return text
	}
	return strings.TrimSpace(rest[index+len(delimiter)+1:])
}
