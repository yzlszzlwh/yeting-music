const http = require('http');
const url = 'http://localhost:3456/api/search_all?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6';
http.get(url, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const j = JSON.parse(data);
            console.log('code:', j.code);
            console.log('results:', j.data?.length || 0);
            j.data?.slice(0, 3).forEach(s => 
                console.log(`  - ${s.name} / ${s.artist} [${s.source}]`)
            );
        } catch(e) {
            console.log('RAW:', data.substring(0, 500));
        }
    });
}).on('error', e => console.error('ERROR:', e.message));
