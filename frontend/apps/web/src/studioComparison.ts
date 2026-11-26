import type { CSSProperties } from 'react'

export type ComparisonRef = {
  name: string
  seed: number
}

export type ComparisonPreset = {
  source?: ComparisonRef
  person?: ComparisonRef
  garment?: ComparisonRef
  front?: ComparisonRef
  back?: ComparisonRef
  model?: ComparisonRef
  prompt?: string
  count?: number
  bg?: 'transparent' | 'white'
  maskBox?: { x: number; y: number; w: number; h: number }
}

type ComparisonVisual = {
  shape?: string
  main?: string
  shade?: string
  accent?: string
  bottom?: string
  headline?: string
  subline?: string
  bg?: string
  kind?: string
  tags?: string[]
  scenes?: string[]
  labels?: string[]
  motif?: string
  shirtColor?: string
  motifColor?: string
  transparent?: boolean
  tag?: string
  garmentColor?: string
  note?: string
  beforeBg?: string
  afterBg?: string
  fullBgMask?: boolean
  maskPath?: string
  addedProp?: string
  badge?: string
  flaw?: string
}

export type ComparisonSlide = {
  title: string
  visual: ComparisonVisual
  preset: ComparisonPreset
}

export type ComparisonDemo = {
  beforeLabel: string
  afterLabel: string
  layout: 'wide-after' | 'balanced'
  images?: { before: string; after: string }
  slides: ComparisonSlide[]
}

export type ComparisonArt = {
  html: string
  style: CSSProperties
  tag: { text: string; cls: string } | null
  extraClass?: string
}

export const COMPARISON_DEMOS: Record<string, ComparisonDemo> = {
  apparel_set: {
    beforeLabel: '上传服装图',
    afterLabel: '生成结果',
    layout: 'wide-after',
    images: { before: '/pod-demos/apparel-set-before.jpg', after: '/pod-demos/apparel-set-after.jpg' },
    slides: [
      {
        title: '短款水洗牛仔夹克 · 模特上身套图镜头',
        visual: { shape: 'jacket', main: '#3B6EA5', shade: '#274E7A', bottom: '#2563EB', headline: 'STYLE IT YOUR WAY', subline: 'CROPPED FIT', bg: '#E7E9EE' },
        preset: {
          front: { name: '短款水洗牛仔夹克正面图.png', seed: 3 },
          back: { name: '牛仔夹克后背走线图.png', seed: 3 },
          model: { name: '模特上身参考.png', seed: 1 },
          prompt: '以正面服装图为唯一款式依据，保持短款水洗牛仔夹克的版型、衣长、领型、胸部口袋、金属纽扣、走线与面料纹理；输出套图中的一张模特上身镜头，使用同一模特与浅暖灰无缝背景、左前方柔光，不添加广告字、边框或拼图。',
          count: 1,
        },
      },
      {
        title: '冰感原纱防晒衣 · 夏日户外电商套图',
        visual: { shape: 'sunshirt', main: '#E2E8F0', shade: '#94A3B8', bottom: '#1E293B', headline: 'AIRY UPF 100+', subline: 'SUMMER SHIELD', bg: '#E6F0F4' },
        preset: {
          front: { name: '冰感原纱防晒衣正面图.png', seed: 0 },
          back: { name: '防晒衣连帽后背图.png', seed: 0 },
          model: { name: '户外运动模特参考.png', seed: 1 },
          prompt: '保留轻透冰丝面料与连帽拉链设计，生成户外阳光实拍、透气质感与细节展示套图',
          count: 6,
        },
      },
      {
        title: '重磅落肩连帽卫衣 · 9 张全套店铺陈列',
        visual: { shape: 'hoodie', main: '#334155', shade: '#1E293B', bottom: '#0F172A', headline: 'STUDIO CAPSULE', subline: 'HEAVYWEIGHT', bg: '#EBE7E2' },
        preset: {
          front: { name: '炭黑重磅卫衣正面.png', seed: 2 },
          back: { name: '重磅卫衣背面图.png', seed: 2 },
          model: { name: '棚拍男女模特图.png', seed: 4 },
          prompt: '保留落肩廓形与罗纹袖口工艺，一次性输出 9 张正反穿搭、平铺及局部纹理套图',
          count: 9,
        },
      },
    ],
  },
  image_variation: {
    beforeLabel: '上传商品原图',
    afterLabel: '生成结果',
    layout: 'wide-after',
    images: { before: '/pod-demos/image-variation-before.jpg', after: '/pod-demos/image-variation-after.jpg' },
    slides: [
      {
        title: '植物印花帆布包 · 系列感新图案衍生',
        visual: { motif: 'flora', shirtColor: '#E7DCC8', motifColor: '#3F6212', transparent: false, tag: '独立平面印花稿' },
        preset: {
          source: { name: '植物印花帆布包参考图.png', seed: 1 },
          prompt: '解构参考图中的植物形态、线条、配色关系与丝网印刷质感，保留系列视觉语言，重新设计主体母题与构图，输出一张独立平面印花稿，不保留帆布包载体、褶皱与商品阴影。',
          count: 1,
        },
      },
      {
        title: '法式冷萃咖啡礼盒 · 包装视角延展',
        visual: { kind: 'coffeebox', main: '#4338CA', accent: '#EC4899', tags: ['正面陈列', '斜角开盒', '俯拍结构'] },
        preset: {
          source: { name: '法式冷萃礼盒主图.png', seed: 4 },
          prompt: '维持包装视觉与字体标识一致，拓展斜角开盒陈列、俯拍平铺与近景质感视角',
          count: 2,
        },
      },
      {
        title: '极简香薰蜡烛 · 玻璃光影多角度',
        visual: { kind: 'candle', main: '#D97706', accent: '#F59E0B', tags: ['正视图', '侧光折射', '木盖细节'] },
        preset: {
          source: { name: '桌面香薰蜡烛主图.png', seed: 2 },
          prompt: '保持磨砂瓶身与木质瓶盖材质，裂变不同俯仰机位与柔和晨光透射效果',
          count: 4,
        },
      },
    ],
  },
  scene_variation: {
    beforeLabel: '上传白底产品图',
    afterLabel: '生成结果',
    layout: 'wide-after',
    images: { before: '/pod-demos/scene-variation-before.jpg', after: '/pod-demos/scene-variation-after.jpg' },
    slides: [
      {
        title: '法式冷萃礼盒 · 晨光厨房场景延展',
        visual: { kind: 'coffeebox', main: '#3B82F6', scenes: ['海边度假', '晨光木桌', '户外露营', '办公室吧台'] },
        preset: {
          source: { name: '法式冷萃咖啡礼盒白底图.png', seed: 4 },
          prompt: '保持礼盒的轮廓比例、深蓝与粉色包装、金色线条与圆形徽章完全一致，将同一商品放入晨光厨房台面的真实使用场景，礼盒作为主体，仅用冰咖啡与咖啡豆交代情境，不改变商品外观与标识。',
          count: 1,
        },
      },
      {
        title: '不锈钢保温杯 · 4 组随行生活场景',
        visual: { kind: 'tumbler', main: '#0EA5E9', scenes: ['山野徒步', '健身补水', '书房办公', '车载杯架'] },
        preset: {
          source: { name: '不锈钢保温杯白底图.png', seed: 5 },
          prompt: '为保温杯匹配户外露营、健身房、极简办公桌与自驾车内 4 组真实生活光线场景',
          count: 4,
        },
      },
      {
        title: '冰感防晒衣 · 四季户外环境裂变',
        visual: { kind: 'sunshirt', main: '#10B981', scenes: ['滨海步道', '森林露营', '城市骑行', '草地野餐'] },
        preset: {
          source: { name: '防晒衣白底平铺.png', seed: 0 },
          prompt: '将防晒衣置于海边晴空、山野步道与城市骑行场景中，呈现自然微风垂坠感',
          count: 4,
        },
      },
    ],
  },
  pose_variation: {
    beforeLabel: '上传模特/商品图',
    afterLabel: '生成结果',
    layout: 'wide-after',
    images: { before: '/pod-demos/pose-variation-before.jpg', after: '/pod-demos/pose-variation-after.jpg' },
    slides: [
      {
        title: '短款牛仔外套 · 自然姿势变化',
        visual: { shape: 'jacket', main: '#3B6EA5', bottom: '#1E293B', labels: ['正站插兜', '微侧撩发', '迈步抓拍', '回眸背影'] },
        preset: {
          source: { name: '牛仔外套模特正面原图.png', seed: 3 },
          prompt: '保持同一人物面容、发型、短款水洗牛仔夹克与黑色直筒裤、浅灰影棚背景和光线完全一致，只改变自然姿势：重心移到单侧腿、身体轻转、一手轻触头发、一手落在腰部，输出单张全身照，不换场景与服装。',
          count: 1,
        },
      },
      {
        title: '冰感防晒皮肤衣 · 4 组户外轻运动动作',
        visual: { shape: 'sunshirt', main: '#E2E8F0', bottom: '#334155', labels: ['叉腰直立', '侧身抬臂', '轻快慢跑', '拉链细节'] },
        preset: {
          source: { name: '户外防晒衣模特实拍.png', seed: 1 },
          prompt: '输出 4 组户外轻运动展示动作，突出透气版型与袖口防晒护手细节',
          count: 4,
        },
      },
      {
        title: '重磅连帽卫衣 · 4 组潮流街拍姿势',
        visual: { shape: 'hoodie', main: '#334155', bottom: '#0F172A', labels: ['正面抱臂', '单肩侧立', '动态转身', '连帽穿戴'] },
        preset: {
          source: { name: '潮流卫衣模特图.png', seed: 2 },
          prompt: '生成酷感街拍 4 种姿势变体，保持胸前图案完整无变形',
          count: 4,
        },
      },
    ],
  },
  print_extract: {
    beforeLabel: '上传印花衣物图',
    afterLabel: '生成结果',
    layout: 'balanced',
    images: { before: '/pod-demos/print-extract-before.jpg', after: '/pod-demos/print-extract-after.jpg' },
    slides: [
      {
        title: '美式复古徽章卫衣 → 透明底矢量整理稿',
        visual: { motif: 'crest', shirtColor: '#1E293B', motifColor: '#DB2777', transparent: true, tag: 'PNG 透明底' },
        preset: {
          source: { name: '印花卫衣正面图.png', seed: 2 },
          prompt: '剥离胸前复古徽章印花，拉平衣物褶皱并导出透明底高清设计参考稿',
          bg: 'transparent',
        },
      },
      {
        title: '日系几何海浪短袖 → 纯白底无褶皱图案',
        visual: { motif: 'wave', shirtColor: '#334155', motifColor: '#0284C7', transparent: false, tag: '纯白底整理稿' },
        preset: {
          source: { name: '海浪印花T恤实拍.png', seed: 5 },
          prompt: '去除布料折叠阴影，完整提取海浪几何纹样并居中放置在纯白画布',
          bg: 'white',
        },
      },
      {
        title: '植物花卉帆布包 → 高清图案剥离',
        visual: { motif: 'flora', shirtColor: '#D6CFC2', motifColor: '#059669', transparent: true, tag: 'PNG 透明底' },
        preset: {
          source: { name: '花卉印花帆布袋.png', seed: 1 },
          prompt: '矫正斜拍透视变形，提取帆布袋表面的植物线条插画并保留透明背景',
          bg: 'transparent',
        },
      },
    ],
  },
  virtual_try_on: {
    beforeLabel: '上传人像与服装图',
    afterLabel: '生成结果',
    layout: 'balanced',
    images: { before: '/pod-demos/virtual-try-on-before.jpg', after: '/pod-demos/virtual-try-on-after.jpg' },
    slides: [
      {
        title: '白背心人像 + 冰感防晒衣 → 自然上身试穿',
        visual: { shape: 'sunshirt', garmentColor: '#E2E8F0', accent: '#0EA5E9', bottom: '#1E293B' },
        preset: {
          person: { name: '白背心模特正面全身图.png', seed: 1 },
          garment: { name: '浅冰蓝连帽防晒衣正面图.png', seed: 0 },
          prompt: '人物图保留脸、发型、体型、姿势、浅灰背景与光线，服装图仅提供浅冰蓝连帽防晒衣的版型、拉链、袖口与口袋细节；只替换上身白色背心，保留牛仔裤与白鞋，输出单张自然试穿全身照。',
        },
      },
      {
        title: '街头人像 + 短款牛仔夹克 → 街拍试穿效果',
        visual: { shape: 'jacket', garmentColor: '#3B6EA5', accent: '#2563EB', bottom: '#18181B' },
        preset: {
          person: { name: '街拍模特全身参考.png', seed: 4 },
          garment: { name: '短款水洗牛仔夹克.png', seed: 3 },
          prompt: '保持人物动作与面容特征不变，精准换装水洗牛仔短外套并自然呈现衣袖褶皱',
        },
      },
      {
        title: '室内半身 + 炭黑连帽卫衣 → 质感试穿成图',
        visual: { shape: 'hoodie', garmentColor: '#334155', accent: '#DB2777', bottom: '#27272A' },
        preset: {
          person: { name: '时尚博主半身人像.png', seed: 1 },
          garment: { name: '炭黑重磅连帽卫衣.png', seed: 2 },
          prompt: '保留重磅卫衣厚实棉感与胸前徽章位置，匹配柔和室内自然光影',
        },
      },
    ],
  },
  product_retouch: {
    beforeLabel: '上传待修实拍图',
    afterLabel: '生成结果',
    layout: 'balanced',
    images: {
      before: '/pod-demos/product-retouch-before.png',
      after: '/pod-demos/product-retouch-after.png',
    },
    slides: [
      {
        title: '不锈钢保温杯 · 去除杂乱反光与棚拍打光',
        visual: { kind: 'tumbler', main: '#334155', accent: '#DB2777', note: '去杂光 · 商业棚拍质感' },
        preset: {
          source: { name: '不锈钢保温杯棚拍原片.png', seed: 5 },
          prompt: '消除杯身杂乱环境反光与桌面污渍，重构柔和轮廓光与高级金属磨砂质感',
        },
      },
      {
        title: '玻璃精华滴管瓶 · 杂光清理与通透精修',
        visual: { kind: 'serum', main: '#F472B6', accent: '#DB2777', note: '玻璃通透 · 立体高光' },
        preset: {
          source: { name: '护肤精华瓶实拍图.png', seed: 0 },
          prompt: '去掉玻璃表面指纹与杂乱倒影，增强精华液通透折射光感与清晰标签文字',
        },
      },
      {
        title: '极简香薰蜡烛 · 商业静物光影重构',
        visual: { kind: 'candle', main: '#D97706', accent: '#F59E0B', note: '柔光布景 · 干净倒影' },
        preset: {
          source: { name: '桌面香薰蜡烛实拍.png', seed: 2 },
          prompt: '统一棚拍柔和漫反射光照，去除桌面阴影噪点，突出玻璃与木盖温润对比',
        },
      },
    ],
  },
  image_inpaint: {
    beforeLabel: '上传涂抹遮罩原图',
    afterLabel: '生成结果',
    layout: 'balanced',
    slides: [
      {
        title: '涂抹背景区域 → 替换为晨光原木桌面',
        visual: { kind: 'coffeebox', beforeBg: '#E4E4E7', afterBg: '#FEF3C7', fullBgMask: true, maskPath: 'M36,44 L204,44', addedProp: 'wood', badge: '背景局部重绘' },
        preset: {
          source: { name: '法式冷萃礼盒主图.png', seed: 4 },
          prompt: '将涂抹区域替换为自然柔和木纹背景与清晨窗边暖光，保留主体边缘光影',
          maskBox: { x: 40, y: 40, w: 380, h: 90 },
        },
      },
      {
        title: '涂抹杯身周边 → 增加极简水滴与冰块道具',
        visual: { kind: 'tumbler', beforeBg: '#F1F5F9', afterBg: '#E0F2FE', fullBgMask: false, maskPath: 'M158,118 Q186,110 198,154', addedProp: 'ice', badge: '局部道具替换' },
        preset: {
          source: { name: '不锈钢保温杯主图.png', seed: 5 },
          prompt: '在涂抹位置添加晶莹冰块与水珠冷雾氛围，保持保温杯主体纹理不变',
          maskBox: { x: 250, y: 185, w: 120, h: 95 },
        },
      },
      {
        title: '涂抹桌面左下角 → 替换为手冲咖啡壶组合',
        visual: { kind: 'candle', beforeBg: '#F4F4F5', afterBg: '#FCE7F3', fullBgMask: false, maskPath: 'M42,126 Q72,118 86,156', addedProp: 'kettle', badge: '局部元素重绘' },
        preset: {
          source: { name: '桌面香薰蜡烛主图.png', seed: 2 },
          prompt: '将涂抹区域重绘为陶瓷手冲壶与咖啡豆点缀，提升居家仪式感氛围',
          maskBox: { x: 70, y: 170, w: 120, h: 100 },
        },
      },
    ],
  },
  image_erase: {
    beforeLabel: '上传涂抹消除原图',
    afterLabel: '生成结果',
    layout: 'balanced',
    slides: [
      {
        title: '涂抹角落水印与促销角标 → 智能无痕消除',
        visual: { kind: 'tumbler', flaw: 'watermark', maskPath: 'M152,26 L204,52', badge: '水印角标消除' },
        preset: {
          source: { name: '带水印商品实拍图.png', seed: 5 },
          maskBox: { x: 300, y: 36, w: 118, h: 58 },
        },
      },
      {
        title: '涂抹背景路人与杂物 → 自动填充洁净背景',
        visual: { kind: 'sunshirt', flaw: 'passerby', maskPath: 'M156,78 L188,154', badge: '路人杂物消除' },
        preset: {
          source: { name: '户外防晒衣路人原图.png', seed: 1 },
          maskBox: { x: 305, y: 125, w: 86, h: 135 },
        },
      },
      {
        title: '涂抹桌面电源线与污渍 → 还原干净大理石台面',
        visual: { kind: 'serum', flaw: 'cable', maskPath: 'M36,148 Q115,168 192,140', badge: '线缆污渍消除' },
        preset: {
          source: { name: '精华液桌面实拍图.png', seed: 0 },
          maskBox: { x: 85, y: 220, w: 280, h: 62 },
        },
      },
    ],
  },
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] || char)
}

function baDrawGarment(cx: number, cy: number, scale: number, shape?: string, main?: string, shade?: string, accent?: string) {
  const col = main || '#3B6EA5'
  const sh = shade || '#1E3A5F'
  const ac = accent || '#DB2777'
  if (shape === 'jacket') {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <path d="M-36,-28 L-16,-38 L16,-38 L36,-28 L54,18 L38,24 L30,-4 L30,36 L-30,36 L-30,-4 L-38,24 L-54,18 Z" fill="${col}" stroke="${sh}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M-16,-38 L0,-22 L16,-38 L10,-26 L0,-18 L-10,-26 Z" fill="${sh}" opacity="0.5"/>
      <line x1="0" y1="-20" x2="0" y2="36" stroke="${sh}" stroke-width="1.8"/>
      <rect x="-22" y="-12" width="14" height="15" rx="2" fill="${sh}" opacity="0.26" stroke="${sh}" stroke-width="1.2"/>
      <rect x="8" y="-12" width="14" height="15" rx="2" fill="${sh}" opacity="0.26" stroke="${sh}" stroke-width="1.2"/>
    </g>`
  }
  if (shape === 'hoodie') {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <path d="M-18,-44 Q0,-54 18,-44 L22,-32 L38,-24 L54,22 L38,28 L28,-2 L28,40 L-28,40 L-28,-2 L-38,28 L-54,22 L-38,-24 L-22,-32 Z" fill="${col}" stroke="${sh}" stroke-width="2" stroke-linejoin="round"/>
      <ellipse cx="0" cy="-34" rx="14" ry="8" fill="${sh}" opacity="0.55"/>
      <path d="M-16,12 L16,12 L22,34 L-22,34 Z" fill="${sh}" opacity="0.3"/>
      <circle cx="0" cy="-6" r="8" fill="${ac}" opacity="0.88"/>
    </g>`
  }
  return `<g transform="translate(${cx},${cy}) scale(${scale})">
    <path d="M-16,-42 Q0,-50 16,-42 L20,-30 L38,-22 L54,22 L40,27 L28,0 L28,38 L-28,38 L-28,0 L-40,27 L-54,22 L-38,-22 L-20,-30 Z" fill="${col}" stroke="${sh}" stroke-width="1.8" stroke-linejoin="round"/>
    <line x1="0" y1="-28" x2="0" y2="38" stroke="${ac}" stroke-width="1.6" stroke-dasharray="3 2"/>
    <path d="M-12,-28 Q0,-22 12,-28" fill="none" stroke="${sh}" stroke-width="1.4"/>
  </g>`
}

function baDrawModel(cx: number, cy: number, scale: number, pose: string, topColor?: string, bottomColor?: string) {
  const top = topColor || '#3B6EA5'
  const bot = bottomColor || '#1E293B'
  const skin = '#F3C6B1'
  const hair = '#3A2821'
  const armL = pose === 'raise' ? 'M-12,-24 L-28,-42' : pose === 'hip' ? 'M-12,-24 L-21,-5 L-11,5' : 'M-12,-24 L-17,12'
  const armR = pose === 'raise' ? 'M12,-24 L28,-40' : pose === 'hip' ? 'M12,-24 L21,-5 L11,5' : 'M12,-24 L17,12'
  const legL = pose === 'walk' ? 'M-6,15 L-16,58' : 'M-6,15 L-8,58'
  const legR = pose === 'walk' ? 'M6,15 L18,56' : 'M6,15 L8,58'
  return `<g transform="translate(${cx},${cy}) scale(${scale})">
    <rect x="-3" y="-34" width="6" height="9" rx="2" fill="${skin}"/>
    <circle cx="0" cy="-42" r="8" fill="${skin}"/>
    <path d="M-9,-43 Q0,-55 9,-43 L10,-35 Q0,-39 -10,-35 Z" fill="${hair}"/>
    <path d="${armL}" fill="none" stroke="${top}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${armR}" fill="none" stroke="${top}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${legL}" fill="none" stroke="${bot}" stroke-width="7.5" stroke-linecap="round"/>
    <path d="${legR}" fill="none" stroke="${bot}" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M-13,-26 L13,-26 L11,16 L-11,16 Z" fill="${top}" stroke="rgba(9,9,11,0.16)" stroke-width="1.1"/>
    <line x1="0" y1="-25" x2="0" y2="16" stroke="rgba(9,9,11,0.22)" stroke-width="1"/>
    <rect x="-11" y="11" width="22" height="8" rx="2" fill="${bot}"/>
    ${pose === 'back' ? '<path d="M-9,-44 Q0,-55 9,-44 L9,-31 L-9,-31 Z" fill="' + hair + '"/>' : ''}
  </g>`
}

function baDrawProduct(cx: number, cy: number, scale: number, kind: string | undefined, main?: string, accent?: string, hasGlare = false) {
  const col = main || '#334155'
  const ac = accent || '#DB2777'
  if (kind === 'coffeebox') {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <rect x="-32" y="-34" width="64" height="68" rx="8" fill="#FFFFFF" stroke="#D4D4D8" stroke-width="2"/>
      <rect x="-32" y="-34" width="64" height="20" rx="6" fill="${col}"/>
      <circle cx="0" cy="8" r="14" fill="${ac}" opacity="0.18"/>
      <circle cx="0" cy="8" r="8" fill="${ac}"/>
      <rect x="-18" y="-26" width="36" height="4" rx="2" fill="#FFFFFF" opacity="0.85"/>
      ${hasGlare ? '<path d="M-34,-28 L34,26 M-28,-36 L36,10" stroke="rgba(255,255,255,0.75)" stroke-width="8"/>' : ''}
    </g>`
  }
  if (kind === 'candle') {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <rect x="-24" y="-30" width="48" height="10" rx="3" fill="#B45309"/>
      <rect x="-26" y="-20" width="52" height="54" rx="8" fill="#FFFBEB" stroke="#F59E0B" stroke-width="2"/>
      <rect x="-18" y="-4" width="36" height="22" rx="4" fill="#FFFFFF" stroke="#E4E4E7"/>
      <rect x="-11" y="4" width="22" height="4" rx="2" fill="${col}"/>
      ${hasGlare ? '<path d="M-24,-14 L24,28" stroke="rgba(255,255,255,0.8)" stroke-width="9"/>' : '<rect x="-20" y="-16" width="6" height="44" rx="3" fill="#FFFFFF" opacity="0.7"/>'}
    </g>`
  }
  if (kind === 'serum') {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <rect x="-5" y="-42" width="10" height="16" rx="4" fill="#18181B"/>
      <rect x="-10" y="-28" width="20" height="8" rx="2" fill="#D4D4D8"/>
      <rect x="-20" y="-20" width="40" height="56" rx="9" fill="${col}" opacity="0.85" stroke="#BE185D" stroke-width="1.5"/>
      <rect x="-14" y="-6" width="28" height="24" rx="4" fill="#FFFFFF"/>
      <rect x="-8" y="4" width="16" height="4" rx="2" fill="${ac}"/>
      ${hasGlare ? '<path d="M-18,-14 L18,30" stroke="rgba(255,255,255,0.82)" stroke-width="8"/>' : '<rect x="-15" y="-15" width="5" height="44" rx="2.5" fill="#FFFFFF" opacity="0.55"/>'}
    </g>`
  }
  return `<g transform="translate(${cx},${cy}) scale(${scale})">
    <rect x="-14" y="-44" width="28" height="12" rx="4" fill="#18181B"/>
    <rect x="-20" y="-32" width="40" height="70" rx="10" fill="${col}"/>
    <rect x="-14" y="-12" width="28" height="20" rx="4" fill="#FFFFFF" opacity="0.92"/>
    <circle cx="0" cy="-2" r="5" fill="${ac}"/>
    ${hasGlare
      ? '<path d="M-22,-22 L22,20 M-18,0 L20,34" stroke="rgba(255,255,255,0.84)" stroke-width="7" stroke-linecap="round"/>'
      : '<rect x="-14" y="-28" width="6" height="60" rx="3" fill="rgba(255,255,255,0.34)"/>'}
  </g>`
}

export function buildComparisonArtSvg(toolId: string, slideIdx: number, side: 'before' | 'after'): ComparisonArt {
  const demo = COMPARISON_DEMOS[toolId]
  if (!demo) return { html: '', style: {}, tag: null }
  const slide = demo.slides[slideIdx] || demo.slides[0]
  const v = slide.visual
  const w = side === 'before' ? 240 : 340
  const h = 270

  if (toolId === 'apparel_set') {
    if (side === 'before') {
      return {
        style: { background: '#FFFFFF' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FFFFFF"/>
          <ellipse cx="120" cy="222" rx="64" ry="10" fill="#E4E4E7" opacity="0.72"/>
          ${baDrawGarment(120, 128, 1.88, v.shape, v.main, v.shade, '#DB2777')}
        </svg>`,
      }
    }
    const bg = v.bg || '#E7E9EE'
    return {
      style: { background: bg },
      tag: null,
      html: `<svg viewBox="0 0 380 ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="380" height="${h}" fill="${bg}"/>
        <text x="190" y="34" text-anchor="middle" fill="#1E3A8A" font-size="17" font-weight="800" font-family="Inter, sans-serif">${escapeHtml(v.headline || 'STYLE IT YOUR WAY')}</text>
        <text x="190" y="54" text-anchor="middle" fill="#52525B" font-size="10" font-weight="600" font-family="Inter, sans-serif">6-9 张电商全套图 · 统一光影与多机位展示</text>
        <text x="190" y="160" text-anchor="middle" fill="rgba(15,23,42,0.08)" font-size="44" font-weight="900" font-family="Inter, sans-serif">${escapeHtml(v.subline || 'CROPPED FIT')}</text>
        ${baDrawModel(72, 166, 1.24, 'raise', v.main, v.bottom)}
        ${baDrawModel(190, 164, 1.28, 'hip', v.main, v.bottom)}
        ${baDrawModel(308, 166, 1.24, 'back', v.main, v.bottom)}
      </svg>`,
    }
  }

  if (toolId === 'virtual_try_on') {
    if (side === 'before') {
      return {
        style: { background: '#FAFAFA' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FAFAFA"/>
          <rect x="12" y="18" width="96" height="234" rx="12" fill="#FFFFFF" stroke="#E4E4E7"/>
          ${baDrawModel(60, 128, 1.06, 'stand', '#E4E4E7', '#3F3F46')}
          <rect x="24" y="220" width="72" height="19" rx="9.5" fill="#18181B"/>
          <text x="60" y="233" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="700">人物参考图</text>
          <circle cx="120" cy="135" r="12" fill="#DB2777"/>
          <text x="120" y="139.5" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="800">+</text>
          <rect x="132" y="18" width="96" height="234" rx="12" fill="#FFFFFF" stroke="#E4E4E7"/>
          ${baDrawGarment(180, 122, 0.78, v.shape, v.garmentColor, '#334155', v.accent)}
          <rect x="144" y="220" width="72" height="19" rx="9.5" fill="#18181B"/>
          <text x="180" y="233" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="700">目标服装图</text>
        </svg>`,
      }
    }
    return {
      style: { background: 'linear-gradient(135deg,#F8FAFC 0%,#FCE7F3 100%)' },
      tag: { text: '自然上身试穿', cls: '' },
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <ellipse cx="170" cy="238" rx="64" ry="9" fill="rgba(24,24,27,0.12)"/>
        ${baDrawModel(170, 144, 1.48, 'hip', v.garmentColor, v.bottom)}
      </svg>`,
    }
  }

  if (toolId === 'image_variation') {
    if (side === 'before') {
      return {
        style: { background: '#FFFFFF' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FFFFFF"/>
          <ellipse cx="120" cy="216" rx="56" ry="9" fill="#E4E4E7"/>
          ${baDrawProduct(120, 134, 1.62, v.kind, v.main, v.accent, false)}
        </svg>`,
      }
    }
    const tags = v.tags || ['角度 1', '角度 2', '角度 3']
    return {
      style: { background: '#F4F4F5' },
      tag: null,
      html: `<svg viewBox="0 0 360 ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="360" height="${h}" fill="#F4F4F5"/>
        ${[0, 1, 2].map((idx) => {
          const bx = 16 + idx * 112
          const rot = idx === 0 ? -7 : idx === 1 ? 8 : 0
          const sc = idx === 2 ? 1.38 : 1.15
          return `<rect x="${bx}" y="18" width="102" height="234" rx="11" fill="#FFFFFF" stroke="#E4E4E7"/>
            <g transform="rotate(${rot} ${bx + 51} 122)">${baDrawProduct(bx + 51, 122, sc, v.kind, v.main, v.accent, false)}</g>
            <rect x="${bx + 13}" y="214" width="76" height="20" rx="10" fill="#18181B"/>
            <text x="${bx + 51}" y="227.5" text-anchor="middle" fill="#FFFFFF" font-size="9.5" font-weight="700">${escapeHtml(tags[idx])}</text>`
        }).join('')}
      </svg>`,
    }
  }

  if (toolId === 'scene_variation') {
    if (side === 'before') {
      return {
        style: { background: '#FFFFFF' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FFFFFF"/>
          <rect x="26" y="24" width="188" height="222" rx="14" fill="#FAFAFA" stroke="#E4E4E7" stroke-dasharray="5 4"/>
          ${v.kind === 'sunshirt' ? baDrawGarment(120, 134, 1.54, 'sunshirt', '#E2E8F0', '#64748B', v.main) : baDrawProduct(120, 134, 1.62, v.kind, v.main, '#DB2777', false)}
        </svg>`,
      }
    }
    const bgs = ['#DBEAFE', '#FEF3C7', '#DCFCE7', '#FCE7F3']
    const scenes = v.scenes || ['场景 1', '场景 2', '场景 3', '场景 4']
    return {
      style: { background: '#F8FAFC' },
      tag: null,
      html: `<svg viewBox="0 0 380 ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="380" height="${h}" fill="#F8FAFC"/>
        ${[0, 1, 2, 3].map((idx) => {
          const col = idx % 2
          const row = Math.floor(idx / 2)
          const x = 14 + col * 180
          const y = 14 + row * 124
          return `<rect x="${x}" y="${y}" width="172" height="114" rx="10" fill="${bgs[idx]}" stroke="rgba(9,9,11,0.08)"/>
            ${v.kind === 'sunshirt' ? baDrawGarment(x + 86, y + 50, 0.86, 'sunshirt', '#FFFFFF', '#64748B', v.main) : baDrawProduct(x + 86, y + 52, 0.82, v.kind, v.main, '#DB2777', false)}
            <rect x="${x + 10}" y="${y + 84}" width="80" height="19" rx="9.5" fill="rgba(24,24,27,0.84)"/>
            <text x="${x + 50}" y="${y + 97}" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="700">${escapeHtml(scenes[idx])}</text>`
        }).join('')}
      </svg>`,
    }
  }

  if (toolId === 'pose_variation') {
    if (side === 'before') {
      return {
        style: { background: '#FFFFFF' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FFFFFF"/>
          <ellipse cx="120" cy="232" rx="52" ry="8" fill="#E4E4E7" opacity="0.72"/>
          ${baDrawModel(120, 142, 1.38, 'stand', v.main, v.bottom)}
        </svg>`,
      }
    }
    const poses = ['stand', 'hip', 'walk', 'raise']
    const labels = v.labels || ['姿势 1', '姿势 2', '姿势 3', '姿势 4']
    return {
      style: { background: '#F4F4F5' },
      tag: null,
      html: `<svg viewBox="0 0 380 ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <rect width="380" height="${h}" fill="#F4F4F5"/>
        ${poses.map((ps, idx) => {
          const x = 12 + idx * 90
          return `<rect x="${x}" y="16" width="84" height="238" rx="10" fill="#FFFFFF" stroke="#E4E4E7"/>
            ${baDrawModel(x + 42, 134, 1.12, ps, v.main, v.bottom)}
            <rect x="${x + 11}" y="216" width="62" height="19" rx="9.5" fill="#18181B"/>
            <text x="${x + 42}" y="229" text-anchor="middle" fill="#FFFFFF" font-size="8.5" font-weight="700">${escapeHtml(labels[idx])}</text>`
        }).join('')}
      </svg>`,
    }
  }

  if (toolId === 'print_extract') {
    const motifSvg = v.motif === 'wave'
      ? '<path d="M-24,8 Q-12,-14 0,4 T24,-8 L24,18 L-24,18 Z" fill="#0284C7"/><circle cx="12" cy="-14" r="6" fill="#F59E0B"/>'
      : v.motif === 'flora'
        ? '<circle cx="0" cy="-4" r="14" fill="none" stroke="#059669" stroke-width="3"/><circle cx="0" cy="-4" r="5" fill="#DB2777"/><path d="M0,10 L0,24 M0,16 L-12,10 M0,16 L12,10" stroke="#059669" stroke-width="2.5" stroke-linecap="round"/>'
        : '<polygon points="0,-22 19,-6 12,18 -12,18 -19,-6" fill="none" stroke="#DB2777" stroke-width="3"/><circle cx="0" cy="0" r="7" fill="#DB2777"/>'
    if (side === 'before') {
      return {
        style: { background: '#FAFAFA' },
        tag: null,
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="#FAFAFA"/>
          <g transform="rotate(-6 120 135)">
            ${baDrawGarment(120, 135, 1.72, 'hoodie', v.shirtColor, '#0F172A', v.motifColor)}
            <g transform="translate(120,126) scale(0.98)">${motifSvg}</g>
          </g>
        </svg>`,
      }
    }
    return {
      style: v.transparent ? {} : { background: '#FFFFFF' },
      extraClass: v.transparent ? 'ba-checker-bg' : '',
      tag: { text: v.tag || 'PNG 透明底', cls: '' },
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g transform="translate(170,135) scale(2.75)">${motifSvg}</g>
      </svg>`,
    }
  }

  if (toolId === 'product_retouch') {
    if (side === 'before') {
      return {
        style: { background: 'linear-gradient(180deg,#E4E4E7 0%,#E4E4E7 69.5%,#D4D4D8 69.5%,#D4D4D8 100%)' },
        tag: { text: '实拍杂光原片', cls: 'muted' },
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <ellipse cx="132" cy="214" rx="60" ry="11" fill="#71717A" opacity="0.45"/>
          <g transform="rotate(-4 120 134)">${baDrawProduct(120, 134, 1.56, v.kind, v.main, v.accent, true)}</g>
        </svg>`,
      }
    }
    return {
      style: { background: 'radial-gradient(circle at 50% 45%, #FFFFFF 0%, #F1F5F9 100%)' },
      tag: { text: v.note || '商业棚拍精修', cls: '' },
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <ellipse cx="170" cy="224" rx="84" ry="11" fill="rgba(9,9,11,0.14)"/>
        ${baDrawProduct(170, 134, 1.68, v.kind, v.main, v.accent, false)}
      </svg>`,
    }
  }

  if (toolId === 'image_inpaint') {
    if (side === 'before') {
      return {
        style: { background: v.beforeBg || '#E4E4E7' },
        tag: { text: '粉色涂抹遮罩', cls: 'pink' },
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect width="${w}" height="${h}" fill="${v.beforeBg || '#E4E4E7'}"/>
          ${v.fullBgMask ? '<rect x="18" y="22" width="204" height="226" rx="12" fill="none" stroke="rgba(236,72,153,0.42)" stroke-width="18" stroke-dasharray="10 6"/>' : ''}
          ${baDrawProduct(120, 142, 1.45, v.kind, '#334155', '#DB2777', false)}
          <g transform="translate(0, 28)">
            <path d="${v.maskPath || 'M32,44 L178,44'}" fill="none" stroke="rgba(236,72,153,0.52)" stroke-width="24" stroke-linecap="round"/>
          </g>
        </svg>`,
      }
    }
    const propSvg = v.addedProp === 'ice'
      ? `<g transform="translate(242,182) scale(1.15)">
          <rect x="-14" y="-14" width="24" height="24" rx="5" fill="#BAE6FD" stroke="#FFFFFF" stroke-width="2" transform="rotate(-12)"/>
          <rect x="8" y="-2" width="20" height="20" rx="4" fill="#E0F2FE" stroke="#FFFFFF" stroke-width="2" transform="rotate(14)"/>
          <circle cx="-26" cy="-18" r="4" fill="#FFFFFF" opacity="0.9"/>
          <circle cx="24" cy="-22" r="3" fill="#FFFFFF" opacity="0.9"/>
        </g>`
      : v.addedProp === 'kettle'
        ? `<g transform="translate(90,178) scale(1.15)">
            <path d="M-16,12 L16,12 L12,-14 L-12,-14 Z" fill="#FFFFFF" stroke="#D4D4D8" stroke-width="2"/>
            <path d="M12,-8 L26,-16 L22,-2 Z" fill="#FFFFFF" stroke="#D4D4D8" stroke-width="1.5"/>
            <circle cx="-24" cy="14" r="4" fill="#78350F"/><circle cx="-14" cy="18" r="3.5" fill="#92400E"/>
          </g>`
        : '<rect x="0" y="187" width="340" height="83" fill="#D97706" opacity="0.24"/>'
    return {
      style: { background: `linear-gradient(180deg,${v.afterBg || '#FEF3C7'} 0%,${v.afterBg || '#FEF3C7'} 69.5%,rgba(24,24,27,0.06) 69.5%,rgba(24,24,27,0.06) 100%)` },
      tag: { text: v.badge || '局部替换完成', cls: 'green' },
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        ${propSvg}
        <ellipse cx="170" cy="220" rx="64" ry="9" fill="rgba(9,9,11,0.14)"/>
        ${baDrawProduct(170, 138, 1.54, v.kind, '#334155', '#DB2777', false)}
      </svg>`,
    }
  }

  if (toolId === 'image_erase') {
    const renderScene = (showFlaw: boolean) => {
      if (v.flaw === 'passerby') {
        return `<rect width="${w}" height="${h}" fill="#ECFDF5"/>
          <rect x="0" y="186" width="${w}" height="84" fill="#BBF7D0"/>
          ${baDrawModel(showFlaw ? 92 : 170, 144, 1.24, 'hip', '#E2E8F0', '#1E293B')}
          ${showFlaw ? `<g opacity="0.65"><circle cx="176" cy="112" r="11" fill="#64748B"/><rect x="163" y="126" width="26" height="68" rx="7" fill="#64748B"/></g>` : ''}`
      }
      if (v.flaw === 'cable') {
        return `<rect width="${w}" height="${h}" fill="#F8FAFC"/>
          <rect x="0" y="188" width="${w}" height="82" fill="#E2E8F0"/>
          ${baDrawProduct(showFlaw ? 120 : 170, 134, 1.48, 'serum', '#F472B6', '#DB2777', false)}
          ${showFlaw ? '<path d="M24,198 Q96,226 198,184" fill="none" stroke="#18181B" stroke-width="6" stroke-linecap="round"/>' : ''}`
      }
      return `<rect width="${w}" height="${h}" fill="#F8FAFC"/>
        ${baDrawProduct(showFlaw ? 120 : 170, 138, 1.5, 'tumbler', '#334155', '#DB2777', false)}
        ${showFlaw ? '<g><rect x="144" y="26" width="76" height="26" rx="6" fill="#EF4444"/><text x="182" y="42.5" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="800">SAMPLE</text></g>' : ''}`
    }
    const sceneBg = v.flaw === 'passerby' ? '#ECFDF5' : '#F8FAFC'
    if (side === 'before') {
      return {
        style: { background: sceneBg },
        tag: { text: '涂抹消除区域', cls: 'pink' },
        html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          ${renderScene(true)}
          <g transform="translate(0, 28)">
            <path d="${v.maskPath || 'M152,26 L204,52'}" fill="none" stroke="rgba(236,72,153,0.56)" stroke-width="26" stroke-linecap="round"/>
          </g>
        </svg>`,
      }
    }
    return {
      style: { background: sceneBg },
      tag: { text: v.badge || '智能消除完成', cls: 'green' },
      html: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        ${renderScene(false)}
      </svg>`,
    }
  }

  return { html: '', style: {}, tag: null }
}
