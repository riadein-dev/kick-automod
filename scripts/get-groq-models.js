require('dotenv').config();
async function getModels() {
  const response = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
  });
  const data = await response.json();
  console.log(data.data.map(m => m.id));
}
getModels();
