import axios from 'axios';

const tenantId = 'fbf622e4-a854-4568-a8ba-b5d27ab95f2e';
const url = `http://localhost:3000/works?tenantId=${tenantId}`;

async function test() {
    try {
        console.log('Testing GET /works without token...');
        const res1 = await axios.get(url);
        console.log('Success without token:', res1.status);
    } catch (err) {
        console.error('Error without token:', err.message);
        if (err.response) console.error('Response:', err.response.data);
    }

    try {
        console.log('Testing GET /works WITH BAD token...');
        const res2 = await axios.get(url, {
            headers: { Authorization: 'Bearer badtoken' }
        });
        console.log('Success with bad token:', res2.status);
    } catch (err) {
        console.error('Error with bad token:', err.message);
        if (err.response) console.error('Response:', err.response.data);
    }
}

test();
