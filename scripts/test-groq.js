require('dotenv').config();

async function testGroq() {
  const prompt = "Merhaba";
  console.log("Key:", process.env.GROQ_API_KEY);
  
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.log("HATA DETAYI:", errText);
    } else {
      const data = await response.json();
      console.log("BASARILI:", data.choices[0].message.content);
    }
  } catch (e) {
    console.log("EXCEPTION:", e.message);
  }
}
testGroq();
