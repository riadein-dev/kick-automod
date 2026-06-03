const store = require('./server/store');
const automod = require('./server/automod');

const userId = '123';
const rule = {
  maxRepeats: 3,
  action: 'warn'
};

function testSpam(content) {
  const msg = { sender: { id: userId }, content: content };
  const res = automod.checkSpam(msg, rule);
  console.log(`Msg: "${content}" -> Result:`, res ? res.reason : 'null');
}

store.getAutomodRules = () => ({ rules: { emoteSpam: { enabled: true } } });

testSpam('A');
testSpam('A');
testSpam('A');
testSpam('A');
testSpam('A');
