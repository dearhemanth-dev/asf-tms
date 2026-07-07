// Test Samsara API endpoint
async function testSamsaraAPI() {
  // You'll need to provide the actual API key
  const apiKey = process.env.SAMSARA_API_KEY || 'test-key';
  
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const params = new URLSearchParams({
    startTime: sevenDaysAgo.toISOString(),
    endTime: now.toISOString(),
    limit: '10',
  });

  try {
    console.log('Testing Samsara API...');
    console.log(`Endpoint: https://api.samsara.com/safety-events?${params.toString()}`);
    console.log(`Auth: Bearer ${apiKey.substring(0, 10)}...`);
    
    const response = await fetch(
      `https://api.samsara.com/safety-events?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`Status: ${response.status}`);
    console.log(`Status Text: ${response.statusText}`);
    
    const data = await response.text();
    console.log('Response:', data.substring(0, 500));
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testSamsaraAPI();
