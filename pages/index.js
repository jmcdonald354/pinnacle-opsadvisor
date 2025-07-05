import Head from 'next/head'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

// Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function Home() {
  const [screen, setScreen] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')

  const [industry, setIndustry] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [priorityFeature, setPriorityFeature] = useState([])
  const [painPoint, setPainPoint] = useState([])
  const [painPointOther, setPainPointOther] = useState('')
  const [currentTool, setCurrentTool] = useState('')
  const [customNeeds, setCustomNeeds] = useState('')
  const [submitStatus, setSubmitStatus] = useState('')
  const [recs, setRecs] = useState([])

  const [questionnaireId, setQuestionnaireId] = useState(null)

  const [industries, setIndustries] = useState([])
  const [companySizes, setCompanySizes] = useState([])
  const [priorityFeatures, setPriorityFeatures] = useState([])
  const [painPoints, setPainPoints] = useState([])

  // Load dropdowns
  useEffect(() => {
    async function loadDropdowns() {
      const [{ data: ind }, { data: sz }, { data: pf }, { data: pp }] =
        await Promise.all([
          supabase.from('industries').select('id, name'),
          supabase.from('company_sizes').select('id, label'),
          supabase.from('priority_features').select('id, name'),
          supabase.from('pain_points').select('id, name')
        ])
      setIndustries(ind || [])
      setCompanySizes(sz || [])
      setPriorityFeatures(pf || [])
      setPainPoints(pp || [])
    }
    loadDropdowns()
  }, [])

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setLoginError('Login failed — check credentials.')
    else {
      setLoginError('')
      setScreen('questionnaire')
    }
  }

  const handleSubmit = async () => {
    setSubmitStatus('Submitting...')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      alert("You must be logged in.")
      return
    }

    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        industry,
        companySize,
        priorityFeature,
        painPoint,
        painPointOther,
        currentTool,
        customNeeds
      })
    })
    const data = await res.json()
    setQuestionnaireId(data.questionnaire_id)
    setSubmitStatus('Done.')
    setScreen('results')
  }

  useEffect(() => {
    async function loadRecommendations() {
      if (!questionnaireId) return

      const { data: runs } = await supabase
        .from('recommendation_runs')
        .select('*')
        .eq('questionnaire_id', questionnaireId)

      const enriched = await Promise.all(runs.map(async run => {
        const { data: vendor } = await supabase
          .from('vendor_catalog')
          .select('*')
          .eq('feature_name', run.feature_name) // ✅ match column!
          .single()
        return { ...run, ...vendor }
      }))

      setRecs(enriched)
    }

    if (screen === 'results') {
      loadRecommendations()
    }
  }, [screen, questionnaireId])

  const restart = () => {
    setScreen('login')
    setRecs([])
    setSubmitStatus('')
    setQuestionnaireId(null)
  }

  return (
    <>
      <Head>
        <title>OpsAdvisor</title>
      </Head>

      {screen === 'login' && (
        <div>
          <h2>Login</h2>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
          <button onClick={handleLogin}>Log In</button>
          {loginError && <p>{loginError}</p>}
        </div>
      )}

      {screen === 'questionnaire' && (
        <div>
          <h2>Questionnaire</h2>

          <select value={industry} onChange={e => setIndustry(e.target.value)}>
            <option value="">Select Industry</option>
            {industries.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
          </select>

          <select value={companySize} onChange={e => setCompanySize(e.target.value)}>
            <option value="">Select Company Size</option>
            {companySizes.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>

          <select multiple value={priorityFeature} onChange={e => setPriorityFeature(Array.from(e.target.selectedOptions, o => o.value))}>
            {priorityFeatures.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
          </select>

          <select multiple value={painPoint} onChange={e => setPainPoint(Array.from(e.target.selectedOptions, o => o.value))}>
            {painPoints.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>

          <input value={painPointOther} onChange={e => setPainPointOther(e.target.value)} placeholder="Other Pain Point" />
          <input value={currentTool} onChange={e => setCurrentTool(e.target.value)} placeholder="Current Tools" />
          <textarea value={customNeeds} onChange={e => setCustomNeeds(e.target.value)} placeholder="Additional Needs"></textarea>

          <button onClick={handleSubmit}>Submit</button>
          <p>{submitStatus}</p>
        </div>
      )}

      {screen === 'results' && (
        <div>
          <h2>Recommendations</h2>
          {recs.map((rec, i) => (
            <div key={i}>
              <h3>{rec.feature_name}</h3>
              <p>Price: ${rec.price || 'N/A'}</p>
              {rec.url && <a href={rec.url} target="_blank">Learn More</a>}
            </div>
          ))}
          <button onClick={restart}>Start Over</button>
        </div>
      )}
    </>
  )
}
