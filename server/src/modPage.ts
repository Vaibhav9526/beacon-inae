// A single-file moderator console: paste the MOD_TOKEN, review held reports, see open SOS calls.
export const MOD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beacon moderators</title>
<style>
  :root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#14182b;--muted:#5d6580;--line:#dfe3f0;--ok:#16a34a;--bad:#dc2626;--acc:#ea6a00}
  @media (prefers-color-scheme:dark){:root{--bg:#0e1424;--card:#182036;--text:#eef1fa;--muted:#9aa7c2;--line:#2a3656}}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,sans-serif}
  main{max-width:880px;margin:0 auto;padding:16px}
  h1{font-size:22px;margin:8px 0 14px} h2{font-size:17px;margin:22px 0 8px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0}
  img,video{max-width:100%;border-radius:10px;max-height:340px;background:#000}
  button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 18px;cursor:pointer;color:#fff}
  .approve{background:var(--ok)} .reject{background:var(--bad)} .plain{background:var(--acc)}
  input{font:inherit;padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);min-width:260px}
  .muted{color:var(--muted);font-size:13px} .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .tag{display:inline-block;background:var(--line);border-radius:999px;padding:2px 10px;font-size:12px;margin-right:6px}
  .sos{border-left:6px solid var(--bad)}
</style></head><body><main>
<h1>Beacon moderators</h1>
<div class="row"><input id="tok" type="password" placeholder="moderator token"><button class="plain" id="go">Load</button><span id="msg" class="muted"></span></div>
<h2>Held reports</h2><div id="queue" class="muted">Enter the token to load.</div>
<h2>Open SOS calls</h2><div id="sos" class="muted"></div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hdr=()=>({authorization:'Bearer '+$('tok').value,'content-type':'application/json'});
async function api(p,o){const r=await fetch(p,{...o,headers:hdr()});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.status);return r.json()}
async function load(){
  $('msg').textContent='';
  try{
    const q=await api('/v1/mod/queue');
    $('queue').innerHTML=q.reports.length?q.reports.map(r=>{
      const v=r.aiVerdict||{};
      const media=r.kind==='video'?'<video controls src="'+esc(r.mediaUrl)+'"></video>':'<img src="'+esc(r.mediaUrl)+'">';
      return '<div class="card">'+media+'<p><b>'+esc(r.caption||'(no caption)')+'</b></p>'+
        '<p class="muted">'+esc(r.lat.toFixed(4))+', '+esc(r.lon.toFixed(4))+' · captured '+new Date(r.capturedAt).toLocaleString()+(r.delayed?' · recorded offline':'')+'</p>'+
        '<p><span class="tag">AI: '+esc(v.authenticity||'none')+'</span><span class="tag">'+esc(v.category||'')+'</span>'+(v.concerns||[]).map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</p>'+
        '<p class="muted">'+esc(v.summary||r.summary||'')+(r.note?' · note: '+esc(r.note):'')+'</p>'+
        '<div class="row"><button class="approve" onclick="decide(\\''+r.id+'\\',\\'approve\\')">Publish</button><button class="reject" onclick="decide(\\''+r.id+'\\',\\'reject\\')">Reject</button></div></div>';
    }).join(''):'Nothing is waiting. 🎉';
    const s=await api('/v1/mod/sos');
    $('sos').innerHTML=s.sos.length?s.sos.map(x=>'<div class="card sos"><b>🆘 '+esc(x.name)+'</b> · '+esc(x.note)+(x.medical?'<br><span class="muted">🩺 '+esc(x.medical)+'</span>':'')+
      '<br><span class="muted">'+esc(x.lat)+', '+esc(x.lon)+' · '+new Date(x.ts).toLocaleString()+' · via '+esc(x.via)+'</span>'+
      '<div class="row" style="margin-top:8px"><a href="https://maps.google.com/?q='+esc(x.lat)+','+esc(x.lon)+'" target="_blank">Open map</a><button class="approve" onclick="resolveSos(\\''+x.id+'\\')">Mark resolved</button></div></div>').join(''):'No open calls.';
  }catch(e){$('msg').textContent='⚠ '+e.message}
}
async function decide(id,decision){const note=decision==='reject'?prompt('Reason (optional)')||'':'';await api('/v1/mod/reports/'+id,{method:'POST',body:JSON.stringify({decision,note})});load()}
async function resolveSos(id){await api('/v1/mod/sos/'+id+'/resolve',{method:'POST',body:'{}'});load()}
$('go').onclick=load;$('tok').addEventListener('keydown',e=>e.key==='Enter'&&load());
</script></main></body></html>`;
