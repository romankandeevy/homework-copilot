import type {
  HomeworkAnalysisKind,
  HomeworkAnnotatedLine,
  HomeworkAnnotatedToken,
  HomeworkWrittenAnalysis,
} from '../lib/homeworkContract'
import { analysisLegend, markTitles } from './analysisLegend'
import './WrittenAnalysis.css'

/* Размеченная запись — то, что школьник перечерчивает в тетрадь один в один:
   подчёркнутые члены предложения, морфемы со значками, формула с подстановкой.

   Значки рисуются честно — рамками и градиентами по низу токена, а дуга корня
   и «крышка» суффикса — настоящей геометрией. Ни одного значка символом
   или эмодзи: школьный стандарт задаёт толщину и вид линии, а не глиф. */

const analysisTitles: Record<HomeworkAnalysisKind, string> = {
  'sentence-parse': 'Разбор предложения',
  morphemes: 'Разбор слова по составу',
  'word-analysis': 'Морфологический разбор',
  equation: 'Запись уравнения',
  formula: 'Запись по формуле',
  quote: 'Разбор цитаты',
  generic: 'Разбор',
}

// Значок суффикса — «крышка» ∧ над морфемой. Рисуем ломаной, а не символом:
// у символа своя ширина и своё положение по базовой линии, и над короткой
// морфемой он оказывается не на месте.
function SuffixCap() {
  return (
    <svg className="analysis-token-cap" viewBox="0 0 24 10" aria-hidden="true" focusable="false">
      <path d="M2 9 L12 2 L22 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AnnotatedToken({ token }: { token: HomeworkAnnotatedToken }) {
  const mark = token.mark ?? 'none'
  const className = [
    'analysis-token',
    mark === 'none' ? '' : `analysis-mark-${mark}`,
    token.tight ? 'is-tight' : '',
  ].filter(Boolean).join(' ')

  return (
    <span className={className} data-mark={mark}>
      {token.label && (
        <span className="analysis-token-label" aria-hidden="true">{token.label}</span>
      )}
      <span className="analysis-token-body">
        {mark === 'suffix' && <SuffixCap />}
        <span className="analysis-token-text">{token.text}</span>
      </span>
      {/* Значок несёт смысл, а для читателя с экранным диктором линия под
          словом не звучит вовсе — поэтому дублируем словами. */}
      {mark !== 'none' && (
        <span className="visually-hidden"> ({token.note || markTitles[mark]})</span>
      )}
    </span>
  )
}

function AnnotatedLineRow({ line }: { line: HomeworkAnnotatedLine }) {
  const kind = line.kind ?? 'plain'
  return (
    <div className={`analysis-line analysis-line-${kind}`}>
      {line.lead && <span className="analysis-line-lead">{line.lead}</span>}
      <span className="analysis-line-tokens">
        {line.tokens.map((token, index) => (
          <AnnotatedToken key={`${index}-${token.text}`} token={token} />
        ))}
      </span>
      {line.caption && <span className="analysis-line-caption">{line.caption}</span>}
    </div>
  )
}

export function WrittenAnalysis({ analysis }: { analysis: HomeworkWrittenAnalysis }) {
  if (analysis.blocks.length === 0) return null
  const title = analysis.title || analysisTitles[analysis.kind]
  const legend = analysisLegend(analysis.blocks)

  return (
    <figure className="written-analysis" aria-label={title}>
      <figcaption className="written-analysis-title">{title}</figcaption>
      {analysis.blocks.map((block, blockIndex) => (
        <section className="written-analysis-block" key={(block.title ?? '') + blockIndex}>
          {block.title && <h3 className="written-analysis-block-title">{block.title}</h3>}
          {block.lines.map((line, lineIndex) => (
            <AnnotatedLineRow key={`${lineIndex}-${line.tokens[0]?.text ?? ''}`} line={line} />
          ))}
        </section>
      ))}
      {legend.length > 0 && (
        <ul className="written-analysis-legend">
          {legend.map((entry) => (
            <li key={entry.mark}>
              <span className={`analysis-token analysis-mark-${entry.mark} analysis-legend-sample`} data-mark={entry.mark}>
                <span className="analysis-token-body">
                  {entry.mark === 'suffix' && <SuffixCap />}
                  <span className="analysis-token-text">образец</span>
                </span>
              </span>
              <span className="written-analysis-legend-label">— {entry.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}
