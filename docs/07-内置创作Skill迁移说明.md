# 内置创作 Skill 迁移说明

## 结论

原项目的 POD 电商素材与 AI 商业修图 Skill 已迁移到当前 GO 后端，并接入真实生成链路。前台“管理 @技能库”会显示这些内置规范，但生成时不需要用户手动选择，后端会按当前创作能力自动加载对应 Skill。

## 对应关系

| 前台能力 | Tool ID | 内置 Skill |
| --- | --- | --- |
| 相似图裂变 | `image_variation` / `similar` | `image-variation` |
| 场景裂变 | `scene_variation` | `scene-variation` |
| 姿势裂变 | `pose_variation` | `pose-variation` |
| 印花提取 | `print_extract` | `print-extraction` |
| AI 穿衣 | `virtual_try_on` | `virtual-try-on` |
| 服装套图 | `apparel_set` | `apparel-set` |
| 商品精修 | `product_retouch` | `product-retouch` |
| 涂抹局部重绘 | `image_inpaint` | `image-inpaint` |
| 涂抹局部消除 | `image_erase` | `image-erase` |

原项目中没有在前台展示的裁剪、抠图、高清放大、智能扩图没有迁移。

## 运行规则

1. 后端启动时会幂等写入或更新 9 份内置 Skill，不会重复创建。
2. Worker 生成时自动把对应 Skill 作为主规范，用户填写的提示词作为本次补充要求。
3. 相似图、场景和姿势裂变按输出序号自动分配不同变体方向，避免同批图片构图重复。
4. 服装套图按正面、背面和模特参考自动选择镜头，单次任务分别生成主图、版型、侧面、细节、平铺、穿搭和氛围镜头。
5. 印花提取会自动附加透明底或纯白底要求。
6. 商品精修、局部重绘和局部消除仍以原图真实性为最高约束，用户补充要求不能突破内置规范。
7. 用户在右侧额外选择的个人 Skill 会追加到内置规范之后；如果选择的是当前能力对应的内置 Skill，不会重复注入。

## 提示词规则

- POD 7 项能力和涂抹局部消除允许空提示词直接提交。
- 图片生成、视频生成、产品图生视频、公众号文章、涂抹局部重绘仍要求填写提示词。
- 空提示词提交时，生成仍会使用对应内置 Skill，不会向第三方模型发送空指令。

## 代码位置

- Skill 定义与 Markdown：`backend/internal/studioskills/`
- Skill 入库：`backend/internal/httpapi/studio_skills_seed.go`
- 自动提示词编排：`backend/internal/httpapi/studio_prompts.go`
- Worker 接入：`backend/internal/httpapi/studio_worker.go`
- 前台校验与参考图角色：`frontend/apps/web/src/pages/StudioPage.tsx`
