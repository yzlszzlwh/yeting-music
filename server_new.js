/**
 * 🎵 乐听 — 全免费音乐服务（多源聚合版）
 * 聚合源：网易云 + Free Music Archive + Internet Archive
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== 多源搜索函数 =====

/** 搜索 Free Music Archive（无版权音乐库） */
async function searchFMA(keywords) {
    try {
        const url = `https://freemusicarchive.org/api/track.json?limit=10&sort_by=date_created&sort_dir=desc&q=${encodeURIComponent(keywords)}`;
        const resp = await axios.get(url, { timeout: 10000 });
        return (resp.data?.dataset || []).map(t => ({
            id: 'fma_' + t.track_id,
            name: t.track_title,
            artist: t.artist_name,
            source: 'Free Music Archive',
            sourceTag: 'fma',
            url: t.track_url,
            cover: t.track_image_file || null
        }));
    } catch { return []; }
}

/** 搜索 Internet Archive（公共领域音频） */
async function searchIA(keywords) {
    try {
        const q = encodeURIComponent(keywords + ' AND mediatype:(audio)');
        const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier,title,creator&sort[]=downloads+desc&rows=10&page=1&output=json`;
        const resp = await axios.get(url, { timeout: 10000 });
        return (resp.data?.response?.docs || []).map(d => ({
            id: 'ia_' + d.identifier,
            name: d.title || '未知曲目',
            artist: d.creator || '未知艺术家',
            source: 'Internet Archive',
            sourceTag: 'ia',
            url: `https://archive.org/download/${d.identifier}/${d.identifier}_vbr.m3u`,
            cover: `https://archive.org/download/${d.identifier}/__ia_thumb.jpg`
        }));
    } catch { return []; }
}

// ===== 网易云 API（保留） =====

let neteaseApi = null;
async function getNeteaseApi() {
    if (neteaseApi) return neteaseApi;
    try {
        neteaseApi = require('NeteaseCloudMusicApi');
        console.log('✅ NeteaseCloudMusicApi 加载成功');
        return neteaseApi;
    } catch (e) {
        console.error('❌ NeteaseCloudMusicApi 加载失败:', e.message);
        return null;
    }
}

async function callApi(name, params = {}) {
    const api = await getNeteaseApi();
    if (!api?.[name]) return { code: 500, msg: `API ${name} 不可用` };
    try {
        const result = await api[name]({ ...params, cookie: '', realIP: '' });
        return result.body || result;
    } catch (e) {
        console.error(`API ${name} 错误:`, e.message);
        return { code: 500, msg: e.message };
    }
}

// ===== 聚合搜索 API =====

app.get('/api/search_all', async (req, res) => {
    const { keywords } = req.query;
    if (!keywords) return res.json({ code: 400, msg: '缺少关键词' });

    try {
        const [netease, fma, ia] = await Promise.all([
            callApi('search', { keywords, type: 1, limit: 10, offset: 0 }).catch(() => null),
            searchFMA(keywords),
            searchIA(keywords)
        ]);

        const songs = (netease?.result?.songs || []).map(s => ({
            id: s.id,
            name: s.name,
            artist: s.artists?.[0]?.name || '未知',
            album: s.album?.name || '',
            cover: s.album?.picUrl || '',
            source: '网易云',
            sourceTag: 'netease',
            url: `/api/song/url?id=${s.id}`
        }));

        res.json({ code: 200, data: [...songs, ...fma, ...ia] });
    } catch (e) {
        res.json({ code: 500, msg: e.message });
    }
});

// ===== 网易云独立路由 =====

app.get('/api/search', async (req, res) => {
    const { keywords, type = 1, limit = 30, offset = 0 } = req.query;
    if (!keywords) return res.json({ code: 400, msg: '缺少关键词' });
    res.json(await callApi('search', { keywords, type: +type, limit: +limit, offset: +offset }));
});

app.get('/api/search/hot', async (_, res) => res.json(await callApi('search_hot')));

app.get('/api/personalized', async (req, res) => {
    res.json(await callApi('personalized', { limit: +(req.query.limit || 20) }));
});

app.get('/api/playlist/detail', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: '缺少歌单ID' });
    res.json(await callApi('playlist_detail', { id }));
});

app.get('/api/song/detail', async (req, res) => {
    const { ids } = req.query;
    if (!ids) return res.json({ code: 400, msg: '缺少歌曲ID' });
    res.json(await callApi('song_detail', { ids }));
});

app.get('/api/song/url', async (req, res) => {
    const { id, br = 320000 } = req.query;
    if (!id) return res.json({ code: 400, msg: '缺少歌曲ID' });
    res.json(await callApi('song_url_v1', { id, level: 'standard', br: +br }));
});

app.get('/api/lyric', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: '缺少歌曲ID' });
    res.json(await callApi('lyric_new', { id }));
});

app.get('/api/toplist', async (_, res) => res.json(await callApi('toplist')));
app.get('/api/toplist/detail', async (_, res) => res.json(await callApi('toplist_detail')));
app.get('/api/artist/songs', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: '缺少歌手ID' });
    res.json(await callApi('artist_top_song', { id }));
});
app.get('/api/album', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.json({ code: 400, msg: '缺少专辑ID' });
    res.json(await callApi('album', { id }));
});
app.get('/api/banner', async (_, res) => res.json(await callApi('banner', { type: 0 })));

// ===== 代理 FMA/IA 音频（绕过 CORS）=====

app.get('/api/proxy/audio', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ code: 400, msg: '缺少URL' });
    try {
        const resp = await axios.get(url, { responseType: 'stream', timeout: 30000 });
        resp.data.pipe(res);
    } catch (e) {
        res.status(500).json({ code: 500, msg: '代理失败' });
    }
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===== 启动 =====

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', async () => {
    await getNeteaseApi();
    console.log(`\n🎵 乐听音乐服务（多源聚合版）已启动！`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📱 手机: http://192.168.1.3:${PORT}`);
    console.log(`💻 本地: http://localhost:${PORT}`);
    console.log(`🔍 搜索: /api/search_all?keywords=周杰伦`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
