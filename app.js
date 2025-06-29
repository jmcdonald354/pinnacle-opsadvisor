import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ──────────────────────────────────────────────────────────────────────────────
// Initialize Supabase client
// ──────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  'https://jnwttglnmrcdhexvzahc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impud3R0Z2xubXJjZGhleHZ6YWhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3Njk1NzcsImV4cCI6MjA2NjM0NTU3N30.GjDnvn5tMwnU-DyEj0vYIilD8ZEWPRwno1ZaSoPaVqM'
);

// ──────────────────────────────────────────────────────────────────────────────
// UI references
// ──────────────────────────────────────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const questionnaire = document.getElementById('questionnaire-screen');
const resultsScreen = document.getElementById('results-screen');
const loginError    = document.getElementById('login-error');
const submitBtn     = document.getElementById('submit-btn');
const spinner       = document.getElementById('spinner');
const submitStatus  = document.getElementById('submit-status');
const recsList      = document.getElementById('recs-list');
const restartBtn    = document.getElementById('restart-btn');

// ──────────────────────────────────────────────────────────────────────────────
// Helper: show exactly one screen
// ──────────────────────────────────────────────────────────────────────────────
function show(screen) {
  [loginScreen, questionnaire, resultsScreen].forEach(s =>
    s.style.display = (s === screen ? 'block' : 'none')
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: fetch & populate a <select>
// ──────────────────────────────────────────────────────────────────────────────
async function loadSelect(table, selectId, valueKey='id', textKey='name') {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '<option>Loading…</option>';
  const { data, error } = await supabase
    .from(table)
    .select(`${valueKey}, ${textKey}`)
    .order(textKey);
  if (error) {
    sel.innerHTML = '<option>Error</option>';
    console.error(`Failed to load ${table}:`, error);
  } else {
    sel.innerHTML = data
      .map(r => `<option value="${r[valueKey]}">${r[textKey]}</option>`)
      .join('');
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: get comma-joined text of multi-select
// ──────────────────────────────────────────────────────────────────────────────
function getMultiText(id) {
  return Array
    .from(document.getElementById(id).selectedOptions)
    .map(o => o.text)
    .join(', ');
}

// ──────────────────────────────────────────────────────────────────────────────
// Kick off at the login screen
// ──────────────────────────────────────────────────────────────────────────────
show(loginScreen);

// ──────────────────────────────────────────────────────────────────────────────
// 1) Handle Login
// ──────────────────────────────────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  loginError.textContent = '';
  const email    = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = error.message;
  } else {
    show(questionnaire);
    await Promise.all([
      loadSelect('industries','industry'),
      loadSelect('company_sizes','companySize','id','label'),
      loadSelect('priority_features','priorityFeature'),
      loadSelect('pain_points','painPoint'),
    ]);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 2) Handle Submit → questionnaire_responses + AI + recommendation_runs
// ──────────────────────────────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  submitStatus.textContent = '';
  submitBtn.disabled = true;
  spinner.style.display = 'inline-block';

  // 2.1) get user
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    alert('Login required');
    submitBtn.disabled = false;
    spinner.style.display = 'none';
    return;
  }

  // 2.2) gather answers
  const industry          = document.getElementById('industry').selectedOptions[0].text;
  const company_size      = document.getElementById('companySize').selectedOptions[0].text;
  const priority_features = getMultiText('priorityFeature');
  let   pain_points       = getMultiText('painPoint');
  if (pain_points.includes('Other (please specify)')) {
    const other = document.getElementById('painPointOther').value.trim();
    pain_points = pain_points
      .split(', ')
      .filter(t => t !== 'Other (please specify)')
      .concat(other)
      .join(', ');
  }
  const current_tools = document.getElementById('currentTool').value;
  const custom_needs  = document.getElementById('customNeeds').value;

  const questionnairePayload = {
    user_id:        user.id,
    industry,
    company_size,
    priority_features,
    pain_points,
    current_tools,
    custom_needs
  };

  // 2.3) insert questionnaire & grab its id
  const { data: [savedQ], error: qErr } = await supabase
    .from('questionnaire_responses')
    .insert([ questionnairePayload ])
    .select('id');
  if (qErr || !savedQ) {
    submitStatus.textContent = `Submission error: ${qErr?.message}`;
    submitBtn.disabled = false;
    spinner.style.display = 'none';
    return;
  }

  // 2.4) call your AI function
  const chosenModel = document.getElementById('modelSelect')?.value || 'gpt-3.5-turbo';
  let aiBody;
  try {
    const aiRes = await fetch('/.netlify/functions/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...questionnairePayload,
        model: chosenModel
      })
    });
    aiBody = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiBody.error || aiRes.statusText);

    // ★ vendor_catalog auto-insert
    for (const rec of aiBody.recommendations || []) {
      const name = rec.name;
      const { data: existing, error: selErr } = await supabase
        .from('vendor_catalog')
        .select('id')
        .eq('vendor_name', name)
        .single();
      if (selErr?.code === 'PGRST116') {
        await supabase
          .from('vendor_catalog')
          .insert([{ vendor_name: name, source: 'AI' }]);
      }
    }
  } catch (e) {
    submitStatus.textContent = `Fetch error: ${e.message}`;
    submitBtn.disabled = false;
    spinner.style.display = 'none';
    return;
  }

  // 2.5) log the run
  const recNames = Array.isArray(aiBody.recommendations)
    ? aiBody.recommendations.map(r => r.name)
    : [];
  await supabase
    .from('recommendation_runs')
    .insert([{
      user_id:          user.id,
      questionnaire_id: savedQ.id,
      model:            chosenModel,
      recommendations:  aiBody.recommendations || [],
      recommended_names: recNames,
      cost_usd:         aiBody.total_cost ?? null
    }]);

  // 2.6) render recommendations
  recsList.innerHTML = '';
  for (const [i, r] of (aiBody.recommendations || []).entries()) {
    // fetch pricing & link
    const { data: vendor } = await supabase
      .from('vendor_catalog')
      .select('pricing_low, pricing_medium, pricing_high, pricing_basis, website_url')
      .eq('vendor_name', r.name)
      .single();

    const priceDisplay = vendor && vendor.pricing_low
      ? `${vendor.pricing_low}–${vendor.pricing_high} ${vendor.pricing_basis}`
      : 'Call for pricing';

    const linkURL = vendor && vendor.website_url
      ? `<a href="${vendor.website_url}" target="_blank" rel="noopener">Visit site</a>`
      : 'Call for pricing';

    const card = document.createElement('div');
    card.className = 'recommendation';
    card.innerHTML = `
      <h3>${i+1}. ${r.name}</h3>
      <p>${r.rationale}</p>
      <div class="rec-extra">
        <p><strong>Est. price:</strong> ${priceDisplay}</p>
        <p><strong>Website:</strong> ${linkURL}</p>
      </div>
    `;
    recsList.append(card);
  }

  // 2.7) cleanup & show results
  spinner.style.display = 'none';
  submitBtn.disabled = false;
  show(resultsScreen);
});

// ──────────────────────────────────────────────────────────────────────────────
// 3) Restart button
// ──────────────────────────────────────────────────────────────────────────────
restartBtn.addEventListener('click', () => show(questionnaire));

// ──────────────────────────────────────────────────────────────────────────────
// 4) Debug: schema introspection
// ──────────────────────────────────────────────────────────────────────────────
document.getElementById('load-tables').addEventListener('click', async () => {
  const { data, error } = await supabase.from('table_list').select('table_name');
  document.getElementById('tables-output').textContent =
    error ? error.message : data.map(r => r.table_name).join('\n');
});
