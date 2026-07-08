require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function test() {
  console.log('API Key (ilk 10 karakter):', process.env.GEMINI_API_KEY?.substring(0, 10));
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Merhaba de');
    console.log('BAŞARILI:', result.response.text());
  } catch (e) {
    console.log('HATA DETAYI:', e.message);
  }
}
test();
