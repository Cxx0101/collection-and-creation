import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightIcon, SearchIcon } from '../icons'
import { ProofSheet } from '../ProofSheet'
import { Select } from '../Select'

const PROOF_ITEMS = [
  {
    src: '/pod-demos/product-retouch-after.png',
    alt: '不锈钢保温杯棚拍精修样张',
    label: '商品精修',
    meta: '棚拍 / 去杂光',
  },
  {
    src: '/pod-demos/apparel-set-after.jpg',
    alt: 'POD 服装模特上身套图样张',
    label: '服装套图',
    meta: 'POD / 模特上身',
  },
  {
    src: '/pod-demos/scene-variation-after.jpg',
    alt: '冷萃咖啡礼盒场景裂变样张',
    label: '场景裂变',
    meta: '冷萃礼盒 / 多场景',
  },
]

const WORKFLOWS: Array<{
  index: string
  title: string
  desc: string
  meta: string
  action: string
  to: string
  state?: { tab: string }
}> = [
  {
    index: '01',
    title: '采集爆款',
    desc: '按关键词采集抖音、小红书、TikTok，封面与互动数据一并归档。',
    meta: '10 积分/页 · 最多 30 页',
    action: '打开采集',
    to: '/collect',
  },
  {
    index: '02',
    title: '生成商品图',
    desc: '生图、场景与姿势裂变、POD 套图、局部重绘都在同一个工坊完成。',
    meta: '12 积分起 · 支持 ZIP',
    action: '进入工坊',
    to: '/studio',
  },
  {
    index: '03',
    title: '复刻爆款',
    desc: '拆解视频或图文的分镜、节奏与版式，再换成自己的商品重新生成。',
    meta: '视频 / 图文双模式',
    action: '开始复刻',
    to: '/clone',
  },
  {
    index: '04',
    title: '批量生产',
    desc: '把采集、选品、出图、出片和文章串联为定时工作流，减少重复操作。',
    meta: 'DAG 工作流 · 产物入资产库',
    action: '管理计划',
    to: '/library',
    state: { tab: 'workflows' },
  },
]

export default function HomePage() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [mode, setMode] = useState('clone-video')

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

  return (
    <section id="view-home" className="view-section active home-view" aria-label="灵感广场">
      <div className="home-hero">
        <div className="home-hero-copy">
          <div className="home-kicker">
            <span className="home-kicker-mark" aria-hidden="true" />
            采集 / 生成 / 复刻
          </div>
          <h1>把爆款素材做成可上架的商品图与视频</h1>
          <p className="home-lede">粘贴链接或描述商品，采集参考、生成套图，再把成果统一归档到个人资产库。</p>

          <div className="composer-bar home-composer">
            <SearchIcon size={18} />
            <input
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="粘贴链接或描述商品，例如：不锈钢保温杯多角度主图"
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
              开始处理
            </button>
          </div>

          <div className="chip-row home-quick-row">
            <span className="home-quick-label">常用：</span>
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

          <div className="home-hero-note">平台接口与自有模型可在设置中切换，产物按账号隔离保存。</div>
        </div>

        <ProofSheet items={PROOF_ITEMS} label="近期产物" />
      </div>

      <section className="workflow-section" aria-labelledby="workflow-heading">
        <div className="workflow-head">
          <div>
            <h2 id="workflow-heading">工作流</h2>
            <p>按任务顺序进入对应工具，已有产物继续沉淀到资产库。</p>
          </div>
          <span className="proof-sheet-count tabular">04 STEPS</span>
        </div>

        <div className="workflow-list">
          {WORKFLOWS.map((workflow) => (
            <button
              type="button"
              className="workflow-row"
              key={workflow.index}
              onClick={() => navigate(workflow.to, workflow.state ? { state: workflow.state } : undefined)}
            >
              <span className="workflow-index tabular">{workflow.index}</span>
              <span className="workflow-copy">
                <strong>{workflow.title}</strong>
                <span>{workflow.desc}</span>
              </span>
              <span className="workflow-meta">{workflow.meta}</span>
              <span className="workflow-action">
                {workflow.action}
                <ArrowRightIcon size={15} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </section>
  )
}
