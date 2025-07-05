import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client once per request
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Log request payload
  console.log('✅ API received:', req.body)

  const {
    userId,
    industry,
    company_size,
    priority_features,
    pain_points,
    current_tools,
    custom_needs
  } = req.body

  try {
    // ✅ 1) Call OpenAI Chat Completion
    console.log('🔗 Calling OpenAI...')
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are the Pinnacle Ops Advisor. Return ONLY a comma-separated list of recommended ERP features.'
          },
          {
            role: 'user',
            content: `
Industry: ${industry}
Company Size: ${companySize}
Priority Features: ${priorityFeature}
Pain Points: ${painPoint}
Current Tools: ${currentTool}
Additional Needs: ${customNeeds}
            `
          }
        ]
      })
    })

    const data = await response.json()

    const rawContent = data.choices?.[0]?.message?.content || ''
    const features = rawContent.split(',').map(f => f.trim()).filter(Boolean)

    console.log('✅ Parsed features:', features)

    if (!features.length) {
      console.error('❌ No features parsed.')
      return res.status(500).json({ error: 'No features parsed from OpenAI.' })
    }

    // ✅ 2) Insert questionnaire_responses
    const { data: run, error: runError } = await supabase
      .from('questionnaire_responses')
      .insert([
        {
          user_id: userId,
          industry,
          company_size: companySize,
          priority_features: priorityFeature.join(', '),
          pain_points: painPoint.join(', '),
          pain_point_other: painPointOther,
          current_tools: currentTool,
          custom_needs: customNeeds,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single()

    if (runError) {
      console.error('❌ questionnaire_responses insert failed:', runError)
      throw runError
    } else {
      console.log('✅ questionnaire_responses insert:', run)
    }

    const questionnaireId = run.id

    // ✅ 3) Insert recommendation_runs
    const inserts = features.map(feature => ({
      questionnaire_id: questionnaireId,
      feature_name: feature
    }))

    const { error: insertError } = await supabase
      .from('recommendation_runs')
      .insert(inserts)

    if (insertError) {
      console.error('❌ recommendation_runs insert failed:', insertError)
      throw insertError
    } else {
      console.log('✅ recommendation_runs insert succeeded')
    }

    // ✅ Done
    console.log('🚀 Handler complete.')
    res.status(200).json({
      questionnaire_id: questionnaireId,
      raw_result: data
    })

  } catch (error) {
    console.error('❌ Handler failed:', error)
    res.status(500).json({ error: 'Something went wrong' })
  }
}
