import type { StudioTool } from './types'

export const STUDIO_TOOLS: StudioTool[] = [
  { id: 'image', group: 'base', name: '图片生成', tag: '4-16分', desc: '多参考图生图，支持自定义比例与批量出图' },
  { id: 'video', group: 'base', name: '视频生成', tag: '按秒计', desc: '全能参考或首尾帧生成，支持多参考素材' },
  { id: 'product', group: 'base', name: '产品图生视频', tag: '15秒', desc: '固定 15 秒 5 镜可编辑分镜，支持单镜出图或直出' },
  // { id: 'article', group: 'base', name: '公众号文章', tag: '图文', desc: '支持导入参考文档、375px 排版预览与推送绑定公众号' },
  { id: 'image_variation', group: 'pod', name: '相似图裂变', tag: '裂变', desc: '保留主商品结构，一键多角度变体裂变' },
  { id: 'scene_variation', group: 'pod', name: '场景裂变', tag: '≤4场景', desc: '将产品融入最多 4 个不同生活场景' },
  { id: 'pose_variation', group: 'pod', name: '姿势裂变', tag: '≤4姿势', desc: '模特电商展示，批量输出最多 4 种姿势' },
  { id: 'print_extract', group: 'pod', name: '印花提取', tag: '白/透明', desc: '智能剥离衣物印花图案（附 AI 整理稿说明）' },
  { id: 'virtual_try_on', group: 'pod', name: 'AI 穿衣', tag: '双图', desc: '需同时上传人物图与服装图实现自然试穿' },
  { id: 'apparel_set', group: 'pod', name: '服装套图', tag: '6-9张', desc: '基于正反面/模特图生成主图、版型与细节套图' },
  { id: 'product_retouch', group: 'retouch', name: '商品精修', tag: '棚拍', desc: '去除杂乱反光，还原商业级质感打光' },
  { id: 'image_inpaint', group: 'retouch', name: '涂抹局部重绘', tag: '画笔', desc: '使用交互画笔涂抹遮罩区域，按提示词局部替换' },
  { id: 'image_erase', group: 'retouch', name: '涂抹局部消除', tag: '画笔', desc: '涂抹水印、路人或杂物后智能填充消除' },
]

export const GALLERY_TEMPLATES = [
  { category: '视频复刻', platform: '抖音', title: '护肤精华 15s 质地微距 + 场景转场分镜', score: 96, model: 'Seedance 2.5', cost: 36, seed: 0 },
  { category: 'POD 裂变', platform: '小红书', title: '户外露营机能夹克 6-9 张全场景服装套图', score: 93, model: 'Seedream 3.0', cost: 24, seed: 2 },
  { category: '图文重绘', platform: '小红书', title: '极简桌面香薰蜡烛 4 图种草笔记复刻', score: 91, model: 'GPT Image 1', cost: 16, seed: 4 },
  { category: '商品精修', platform: '通用', title: '不锈钢保温杯高反光去除 + 水雾质感精修', score: 89, model: 'Nano Banana Pro', cost: 12, seed: 1 },
  { category: '公众号长文', platform: '微信', title: '夏日冷萃咖啡消费趋势深度长文 + 3 套配图', score: 90, model: 'DeepSeek V3', cost: 8, seed: 3 },
  { category: '视频复刻', platform: 'TikTok', title: '无字幕极简首饰佩戴 12s 动效成片', score: 92, model: 'Kling V2', cost: 30, seed: 5 },
  { category: 'POD 裂变', platform: '抖音', title: '通勤帆布托特包 4 场景模特上身裂变', score: 88, model: 'Seedream 3.0', cost: 24, seed: 1 },
  { category: '商品精修', platform: '小红书', title: '防晒喷雾冰爽水花商业级棚拍主图', score: 94, model: 'Midjourney V6.1', cost: 18, seed: 4 },
]

export const COMPARISON_TOOLS = ['image_variation', 'scene_variation', 'pose_variation', 'print_extract', 'virtual_try_on', 'apparel_set', 'product_retouch']

export const TOOL_COMPARISON: Record<string, { beforeLabel: string; afterLabel: string; examples: { title: string; seed: number; before: string; after: string }[] }> = {
  image_variation: {
    beforeLabel: '上传商品主图',
    afterLabel: '生成多角度变体',
    examples: [
      { title: '法式冷萃礼盒相似图裂变', seed: 4, before: '礼盒正面白底主图', after: '三角度构图与材质细节' },
      { title: '香薰蜡烛相似图裂变', seed: 0, before: '蜡烛正面棚拍', after: '氛围光影与包装变体' },
    ],
  },
  scene_variation: {
    beforeLabel: '上传商品原图',
    afterLabel: '生成场景裂变',
    examples: [
      { title: '防晒衣户外场景裂变', seed: 1, before: '服装白底平铺', after: '山野、城市与通勤场景' },
      { title: '咖啡礼盒桌面场景裂变', seed: 4, before: '礼盒白底主图', after: '晨光餐桌与咖啡馆氛围' },
    ],
  },
  pose_variation: {
    beforeLabel: '上传模特参考',
    afterLabel: '生成姿势裂变',
    examples: [
      { title: '防晒衣姿势裂变', seed: 1, before: '模特正面棚拍', after: '4 组电商姿势自然变换' },
      { title: '托特包模特姿势裂变', seed: 2, before: '手拎正面参考', after: '肩背、手持与动态走姿' },
    ],
  },
  print_extract: {
    beforeLabel: '上传服装图',
    afterLabel: '生成印花提取',
    examples: [
      { title: '卫衣胸口印花提取', seed: 2, before: '服装正面完整图', after: '透明底图案干净剥离' },
      { title: '帆布托特包图形提取', seed: 5, before: '包身实拍图', after: '纯白底矢量感整理稿' },
    ],
  },
  virtual_try_on: {
    beforeLabel: '上传人物与服装图',
    afterLabel: '生成结果',
    examples: [
      { title: '模特上冰感防晒衣', seed: 0, before: '人物参考 + 目标服装图', after: '自然上身试穿与褶皱还原' },
      { title: '模特上通勤夹克', seed: 2, before: '棚拍模特 + 服装平铺', after: '光影一致的真实试穿效果' },
    ],
  },
  apparel_set: {
    beforeLabel: '上传服装套图参考',
    afterLabel: '生成套图',
    examples: [
      { title: '防晒衣 6 张电商套图', seed: 1, before: '正面、背面与模特参考图', after: '主图、版型、细节与场景套图' },
      { title: '机能夹克 9 张全套图', seed: 2, before: '正反面服装平铺图', after: '九宫格电商标准套图' },
    ],
  },
  product_retouch: {
    beforeLabel: '上传待修实拍图',
    afterLabel: '生成结果',
    examples: [
      { title: '保温杯去杂光精修', seed: 5, before: '实拍杂光原片', after: '商业棚拍柔光与金属质感' },
      { title: '香薰罐去瑕疵精修', seed: 0, before: '桌面杂乱反光原片', after: '干净背景与高级质感打光' },
    ],
  },
}

export const DEFAULT_PROMPTS: Record<string, string> = {
  image: '',
  video: '',
  product: '',
  article: '',
}
