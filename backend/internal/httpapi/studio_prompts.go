package httpapi

import (
	"strconv"
	"strings"

	"sparkstudio/backend/internal/models"
	"sparkstudio/backend/internal/studioskills"
)

var imageVariationFocuses = []string{
	"母题替换：选择同主题的新主体，按原图的造型语法重绘，并重组配角与留白",
	"元素融合：引入相关新元素，统一笔触和色彩关系，同时改变主体姿态与组合关系",
	"构图重构：改变视觉重心、疏密和排列节奏，同时重新设计主体轮廓与内部图案",
	"系列衍生：设计新的主体细节与装饰母题，延续媒介质感和配色关系，重排层次与比例",
}

var sceneVariationDirections = []string{
	"日常使用：选择最典型的实际使用环境，构图自然，清楚呈现商品与用途的关系。",
	"细分情境：换成有明确使用动机的新地点或事件，让环境和道具交代具体需求。",
	"氛围陈列：在不同空间选择合适的光线与真实材质衬景，以商品陈列为视觉重点。",
	"礼赠或拓展：适合礼赠时展示真实的赠送或节日情境，否则选择另一种可信的使用场合。",
}

var poseVariationDirections = []string{
	"重心变化：将承重转向另一侧，让肩、髋和手臂一起调整；坐姿用上身重心偏移代替。",
	"身体转向：轻微转动躯干，头部和视线顺势回看，领口或前襟仍清楚可见。",
	"微动态：全身图选自然迈出短步的瞬间，半身或坐姿用肩部前移与可见手臂摆动代替。",
	"手部动作：一手轻触原有衣边或配饰，另一侧手臂舒展，躯干配合调整，不遮挡设计细节。",
}

type apparelShot struct {
	title     string
	direction string
}

func composeStudioPrompt(tool, userPrompt string) string {
	userPrompt = strings.TrimSpace(userPrompt)
	skill, ok := studioskills.ForTool(tool)
	if !ok {
		return userPrompt
	}
	sections := []string{skill.Content}
	if userPrompt != "" {
		sections = append(sections, "【本次用户补充要求】\n"+userPrompt)
	}
	sections = append(sections, "请严格执行以上创作规范。用户补充要求仅调整本次创作方向，不得突破规范中的商品一致性、人物一致性和真实性约束。最终只输出任务要求的图片。")
	return strings.Join(sections, "\n\n")
}

func (s *Server) additionalSkillPrompt(userID uint, tool string, params map[string]interface{}) string {
	skillID := uint(numberAsInt(params["skillId"]))
	if skillID == 0 {
		return ""
	}
	var skill models.Skill
	if err := s.DB.Where("id = ? AND (builtin = ? OR owner_user_id = ?)", skillID, true, userID).First(&skill).Error; err != nil {
		return ""
	}
	if core, ok := studioskills.ForTool(tool); ok && skill.Name == core.Name {
		return ""
	}
	return "# " + skill.Name + "\n" + truncateRunes(skill.Content, 12000)
}

func composeImagePrompt(tool, basePrompt string, params map[string]interface{}, index, referenceCount int) string {
	if index < 0 {
		index = 0
	}
	sections := []string{strings.TrimSpace(basePrompt)}
	switch tool {
	case "image_variation", "similar":
		sections = append(sections,
			"本张为独立变体。优先变化侧重点："+imageVariationFocuses[index%len(imageVariationFocuses)]+"。",
			"先解构形态、线条、色彩、构图和质感，再完成新元素的风格化转译与画面重构。每张至少产生两项一眼可辨的设计变化，其中至少一项属于主体。",
		)
	case "scene_variation":
		sections = append(sections,
			"本张场景方向："+sceneVariationDirections[index%len(sceneVariationDirections)],
			"场景必须发生实质变化，并始终让同一商品保持主体地位。",
		)
	case "pose_variation":
		sections = append(sections,
			"本张姿势方向："+poseVariationDirections[index%len(poseVariationDirections)],
			"动作差异必须一眼可辨，同时保持人物身份、服装设计与原场景一致。",
		)
	case "print_extract":
		background := firstText(params["printBackground"], "transparent")
		backgroundText := "输出为均匀纯白背景"
		if background == "transparent" {
			backgroundText = "输出为真正带 alpha 通道的透明背景 PNG，禁止用棋盘格模拟透明"
		}
		sections = append(sections,
			"输出背景："+backgroundText+"。",
			"只整理原图中有依据的可见印花，不猜测、不补全缺失内容。",
		)
	case "virtual_try_on":
		sections = append(sections, "参考图顺序固定：图 1 是人物底图，图 2 是目标服装。图 2 即使有模特也只参考服装本身。")
	case "apparel_set":
		roles := apparelReferenceRoles(params, referenceCount)
		shots := apparelSetShotPlan(roles)
		shot := shots[index%len(shots)]
		roleText := describeApparelRoles(roles)
		sections = append(sections,
			"参考图顺序："+roleText+"。",
			"本张镜头："+shot.title+"。"+shot.direction,
		)
		if containsString(roles, "apparel_model") {
			sections = append(sections, "本套图包含模特参考，主图与上身镜头沿用同一位模特；平铺、挂拍和商品微距镜头只展示服装。")
		} else {
			sections = append(sections, "本套图仅展示衣物，不生成模特。")
		}
	case "image_inpaint":
		sections = append(sections, "只修改涂抹标记覆盖的区域，未标记区域、原图取景和画幅保持不变。")
	case "image_erase":
		sections = append(sections, "只消除涂抹标记覆盖的物体或杂物，并按四周纹理自然补全背景。")
	}
	return strings.Join(nonEmptyStrings(sections), "\n\n")
}

func apparelReferenceRoles(params map[string]interface{}, referenceCount int) []string {
	fallback := []string{"apparel_front", "apparel_back", "apparel_model"}
	raw, _ := params["references"].([]interface{})
	roles := make([]string, 0, referenceCount)
	for index := 0; index < referenceCount; index++ {
		role := ""
		if index < len(raw) {
			if mapping, ok := raw[index].(map[string]interface{}); ok {
				role = strings.TrimSpace(firstText(mapping["role"], ""))
			}
		}
		if role == "" && index < len(fallback) {
			role = fallback[index]
		}
		if role == "" {
			role = "apparel_front"
		}
		roles = append(roles, role)
	}
	if len(roles) == 0 {
		return []string{"apparel_front"}
	}
	return roles
}

func describeApparelRoles(roles []string) string {
	names := map[string]string{
		"apparel_front": "服装正面",
		"apparel_back":  "服装背面",
		"apparel_model": "模特参考",
	}
	parts := make([]string, 0, len(roles))
	for index, role := range roles {
		label := names[role]
		if label == "" {
			label = "服装参考"
		}
		parts = append(parts, "图 "+strconv.Itoa(index+1)+"："+label)
	}
	return strings.Join(parts, "；")
}

func apparelSetShotPlan(roles []string) []apparelShot {
	modeled := containsString(roles, "apparel_model")
	hasBack := containsString(roles, "apparel_back")
	mainDirection := "服装单独正面陈列，完整保留衣摆和袖口等轮廓。"
	if modeled {
		mainDirection = "自然站姿、完整上身，突出商品轮廓和正面设计。"
	}
	backShot := apparelShot{
		title:     "正面结构细节",
		direction: "选原图清楚可见的领口、腰头或主开合结构，用中近景展示。",
	}
	if hasBack {
		backShot = apparelShot{
			title:     "背面剪裁",
			direction: "按背面参考展示整件背面和可见结构，与正面保持配色、长度及质感一致。",
		}
	}
	modelShot := apparelShot{
		title:     "局部比例",
		direction: "用中景展示服装上相邻结构的真实比例与连接关系。",
	}
	if modeled {
		modelShot = apparelShot{
			title:     "半身穿搭",
			direction: "保留模特形象，用服装对应部位的中景展示自然垂感和穿搭比例。",
		}
	}
	return []apparelShot{
		{title: "商品主图", direction: mainDirection},
		{title: "正面版型", direction: "正面平视，突出肩线、腰线、衣长和可见垂感，服装占画面主要面积。"},
		{title: "侧面轮廓", direction: "采用小角度侧前机位，展示厚度和可见外轮廓，不转到未提供的背面。"},
		backShot,
		{title: "面料与工艺", direction: "近距离展现一处可见的织纹、车线、印花或五金，真实呈现纹理尺度。"},
		{title: "平铺或挂拍", direction: "仅展示衣物，按品类平铺或自然挂拍，完整保留轮廓及原有细节。"},
		modelShot,
		{title: "氛围展示", direction: "沿用整套布光和底色，用更宽的取景和少量留白表现服装气质。"},
		{title: "设计亮点", direction: "选择与面料工艺图不同的一处可见设计，展示袖口、下摆或口袋等细节。"},
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func nonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}
