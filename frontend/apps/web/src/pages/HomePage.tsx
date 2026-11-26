import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Artwork } from '../Artwork'
import { GALLERY_TEMPLATES } from '../data'
import { SparkIcon } from '../icons'
import { Select } from '../Select'

const CATEGORIES = ['全部', '视频复刻', '图文重绘', 'POD 裂变', '商品精修', '公众号长文']
const SHOW_FEATURED_GALLERY = false

const PROMPTS: Record<string, string> = {
  视频复刻: '微距水滴落入透明玻璃瓶，柔和晨光穿透精华液，衔接模特上脸轻拍镜头，节奏明快。',
  'POD 裂变': '保留服装版型与胸口刺绣标识，分别生成山野露营、城市街道、纯色平铺与走线细节图。',
  图文重绘: '暖木色桌面晨光氛围，替换目标产品香薰罐，生成干净治愈系居家生活组图与种草文案。',
  商品精修: '商业级棚拍柔光箱打光，保留杯身哑光漆面质感并消除杂乱环境反光。',
  公众号长文: '结构化输出 1500 字行业趋势长文，自动配比 3 张咖啡冲泡场景插图并渲染 fresh 排版。',
}

export default function HomePage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('全部')
  const [value, setValue] = useState('')
  const [mode, setMode] = useState('clone-video')
  const [detail, setDetail] = useState<(typeof GALLERY_TEMPLATES)[number] | null>(null)

  const gallery = useMemo(() => GALLERY_TEMPLATES.filter((item) => filter === '全部' || item.category === filter), [filter])

  const launch = () => {
    if (mode === 'clone-video' || mode === 'clone-photo') {
      navigate('/clone', { state: { mode: mode === 'clone-photo' ? 'photo' : 'video', sourceUrl: value } })
    } else if (mode === 'studio-image') {
      navigate('/studio', { state: { tool: 'image', prompt: value } })
    } else if (mode === 'studio-pod') {
      navigate('/studio', { state: { tool: 'apparel_set', prompt: value } })
    } else {
      navigate('/collect', { state: { keyword: value } })
    }
  }

  const remix = (item: (typeof GALLERY_TEMPLATES)[number]) => {
    const prompt = PROMPTS[item.category] || item.title
    if (item.category === '视频复刻' || item.category === '图文重绘') {
      navigate('/clone', { state: { mode: item.category === '视频复刻' ? 'video' : 'photo', prompt } })
    } else if (item.category === '公众号长文') {
      navigate('/studio', { state: { tool: 'article', prompt } })
    } else if (item.category === 'POD 裂变') {
      navigate('/studio', { state: { tool: 'apparel_set', prompt } })
    } else {
      navigate('/studio', { state: { tool: 'product_retouch', prompt } })
    }
  }

  return (
    <section id="view-home" className="view-section active" aria-label="灵感广场">
      <div className="hero-composer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <span className="badge badge-accent" style={{ marginBottom: 8 }}>
              一个共用积分池 · 支持平台接口与自有大模型双轨切换
            </span>
            <h1>从爆款灵感出发，3 步完成内容复刻与视觉创作</h1>
          </div>
        </div>

        <div className="composer-bar">
          <SparkIcon size={18} color="#DB2777" strokeWidth={2} />
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="粘贴抖音 / 小红书 / TikTok 分享链接，或输入创作提示词（如：法式冷萃咖啡手冲特写海报）"
            onKeyDown={(event) => event.key === 'Enter' && launch()}
          />
          <Select className="select composer-mode-select" value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="clone-video">视频复刻</option>
            <option value="clone-photo">图文复刻</option>
            <option value="studio-image">AI 生图</option>
            <option value="studio-pod">POD 套图</option>
            <option value="collect">按关键词采集</option>
          </Select>
          <button type="button" className="btn btn-accent" onClick={launch}>
            立即开始
          </button>
        </div>

        <div className="chip-row">
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>快捷模板：</span>
          {[
            ['抖音 15s 护肤精华分镜', 'https://v.douyin.com/iY8k9P2a/', 'clone-video'],
            ['POD 服装 6-9 张套图', '日系户外防晒冰丝防晒衣模特穿搭套图', 'studio-pod'],
            ['采集小红书冷萃咖啡', '夏日冷萃咖啡冰杯爆款', 'collect'],
            ['商品精修出图', '都市极简香薰蜡烛电商主图精修', 'studio-image'],
          ].map(([label, nextValue, nextMode]) => (
            <button
              key={label}
              type="button"
              className="chip"
              onClick={() => {
                setValue(nextValue)
                setMode(nextMode)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid-4">
        {[
          {
            badge: '按页计费 · 仅自己可见',
            price: '10 积分/页',
            title: '爆款采集中心',
            desc: '支持抖音 / 小红书 / TikTok，AI 一键从商品提炼关键词，封面自动转存云端对象存储。',
            footer: '最高 30 页 · 实扣退余',
            action: '去采集',
            onClick: () => navigate('/collect'),
            success: true,
          },
          {
            badge: '13 项可视化能力',
            price: '12 积分起',
            title: 'AI 创作工坊',
            desc: '涵盖生图、15s 产品视频、公众号长文排版、POD 服装裂变套图及涂抹局部重绘消除。',
            footer: '支持多参考素材 + ZIP 打包',
            action: '进工坊',
            onClick: () => navigate('/studio'),
          },
          {
            badge: '视频 + 图文双模式',
            price: '全云端模型',
            title: '3 步爆款复刻',
            desc: '自由选择已启用的全部云端模型，支持分镜编辑与九宫格审核，无字幕烧录更干净。',
            footer: '自有接口 0 积分直连',
            action: '去复刻',
            onClick: () => navigate('/clone'),
            success: true,
          },
          {
            badge: '20 种 DAG 节点',
            price: '每日自动跑',
            title: '自动化流水线',
            desc: '一句话生成定时工作流，自动采集选品并批量生成图/视频/文章，幂等防重复生产。',
            footer: '含商品库与资产库',
            action: '管理计划',
            onClick: () => navigate('/library', { state: { tab: 'workflows' } }),
          },
        ].map((card) => (
          <article className="aligned-card" key={card.title}>
            <div className="card-body-flex">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className={`badge ${card.success ? 'badge-success' : 'badge-accent'}`}>{card.badge}</span>
                <span className="tabular" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                  {card.price}
                </span>
              </div>
              <h2 style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 700 }}>{card.title}</h2>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>{card.desc}</p>
            </div>
            <div className="card-footer-stick">
              <span className="help-text">{card.footer}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={card.onClick}>
                {card.action}
              </button>
            </div>
          </article>
        ))}
      </div>

      {SHOW_FEATURED_GALLERY ? <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="page-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>精选创作画廊</h2>
            <p className="page-sub">点击任意案例可预览分镜提示词或 1 键填入工作台开始复用</p>
          </div>
          <div className="chip-row">
            {CATEGORIES.map((category) => (
              <button key={category} type="button" className={`chip ${filter === category ? 'active' : ''}`} onClick={() => setFilter(category)}>
                {category}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-4">
          {gallery.map((item) => (
            <article className="aligned-card" key={item.title}>
              <div className="art-thumb">
                <Artwork seed={item.seed} label={item.title} sublabel={`${item.category} · ${item.model}`} />
                <div className="thumb-overlay-top">
                  <span className="thumb-pill">
                    {item.platform} · {item.category}
                  </span>
                  <span className="thumb-pill score tabular">热度 {item.score}</span>
                </div>
              </div>
              <div className="card-body-flex">
                <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, lineHeight: 1.4 }}>{item.title}</h3>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.55 }}>{PROMPTS[item.category]}</p>
              </div>
              <div className="card-footer-stick">
                <span className="badge tabular">{item.cost} 积分</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setDetail(item)}>
                    详情
                  </button>
                  <button type="button" className="btn btn-accent btn-sm" onClick={() => remix(item)}>
                    1键复用
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div> : null}

      {detail ? (
        <div className="modal-backdrop open" onClick={(event) => event.target === event.currentTarget && setDetail(null)} role="dialog" aria-modal="true">
          <div className="modal-box">
            <div className="modal-head">
              <h3>{detail.title}</h3>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDetail(null)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <div className="art-thumb" style={{ marginBottom: 0 }}>
                <Artwork seed={detail.seed} label={detail.title} sublabel={detail.model} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge badge-accent">{detail.category}</span>
                <span className="badge">推荐模型：{detail.model}</span>
                <span className="badge tabular">参考消耗：{detail.cost} 积分</span>
              </div>
              <div className="field">
                <span className="field-label">结构化提示词脚本</span>
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 13 }}>
                  {PROMPTS[detail.category]}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setDetail(null)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  const current = detail
                  setDetail(null)
                  remix(current)
                }}
              >
                一键带入创作台
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
