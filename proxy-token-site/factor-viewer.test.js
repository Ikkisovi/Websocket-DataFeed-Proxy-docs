const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, 'public/reports/factor-stats');
const tick = () => new Promise(resolve => setTimeout(resolve, 35));
const version = 'a'.repeat(64);
const stats = { n:30, cum:.1, mean:.001, sharpe:1, mdd:-.02, turnover:.05, cash_names:0 };
const summary = Object.fromEntries(['full','7d','14d','30d'].map(k => [k,{ic:{n:30,mean:.01,icir:.1,t:2,hit:.55},long:stats,short:stats,ls:stats}]));
const rec = {id:'fd_test',family:'momentum',requires:['close'],note:'Original implementation.',proxy:'',coverage:.9,first_valid:'2026-10-01',last_signal_date:'2026-10-22',latest_names:40,summary,
  page:{title:'Ranking momentum',title_zh:'排名动量',tags:[],category:'momentum',intro:'Where $N$ is the number of stocks.',
    formulas:[{text:'Score',latex:'R_{i,t}=P_t/P_{t-1}-1'}],symbols:[{symbol:'R_{i,t}',meaning:'Return $R_{i,t}$ of stock i.'}],
    explanation:'Rank $R_{i,t}$ across stocks. <img src=x onerror=alert(1)>',
    localized:{zh:{title:'排名动量',intro:'其中 $N$ 为股票数。',formulas:[{text:'得分',latex:'R_{i,t}=P_t/P_{t-1}-1'}],symbols:[{symbol:'R_{i,t}',meaning:'股票 i 的日收益率 $R_{i,t}$。'}],explanation:'对日收益率 $R_{i,t}$ 做横截面排名。'}}},
  series:{ic:[100,200,100],long:[100,-10,200],short:[-10,100,0],names_last:40},dist:null};
const row = {id:rec.id,shard:0,title:rec.page.title,title_zh:rec.page.title_zh,tags:[],category:'momentum',summary,
  nav_preview:Object.fromEntries(['full','7d','14d','30d'].map(k=>[k,{ls:[1,1.05,.98,1.1],long:[1,1.2,1.1,1.3]}]))};

async function page(locale) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://leandata.uk/reports/factor-stats/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;w.scrollTo=()=>{};let language=locale;
  w.LeandataI18n={getLanguage:()=>language,setLanguage:value=>{language=value;w.dispatchEvent(new w.Event('leandata:languagechange'));}};
  w.fetch=async url=>({ok:true,status:200,json:async()=>{
    if(url.endsWith('/index.json')) return {
      meta:{snapshot_id:version,last_signal_date:'2026-10-22',last_label_date:'2026-10-21',update_policy:'after_complete_session',caveats:[],label:'next-day return'},
      dates:['2026-10-19','2026-10-20','2026-10-21'],factors:[row],zh:{categories:{},families:{},tags:{}},
    };
    expect(url).toContain('?v='+version);return {[rec.id]:rec};
  }});
  w.eval(fs.readFileSync(path.join(root,'vendor/katex-0.19.0/katex.min.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'factor-stats.js'),'utf8'));await tick();await tick();
  return dom;
}

describe('factor viewer plots, copy and inline mathematics',()=>{
  for(const locale of ['zh','en']) it(`renders the ${locale} list and localized math with local assets`,async()=>{
    const dom=await page(locale),d=dom.window.document;
    try{
      expect(d.querySelector('svg.nav-spark')).not.toBeNull();
      const before=d.querySelector('.nav-spark path').getAttribute('d');d.querySelector('[data-nav="long"]').click();
      expect(d.querySelector('.nav-spark path').getAttribute('d')).not.toBe(before);
      d.querySelector('[data-win="7d"]').click();expect(d.querySelector('.nav-spark').getAttribute('aria-label')).toContain(locale==='zh'?'近 7 天':'7 days');
      d.querySelector('tbody tr').click();await tick();await tick();
      expect(d.querySelector('.expl').textContent).toContain(locale==='zh'?'横截面排名':'across stocks');
      expect(d.querySelectorAll('.sym dd .katex').length).toBeGreaterThan(0);
      expect(d.querySelectorAll('.expl .katex').length).toBeGreaterThan(0);
      expect(d.querySelector('.expl').textContent).not.toContain('$R_');
      expect(d.querySelector('.expl img')).toBeNull();
      dom.window.LeandataI18n.setLanguage(locale==='zh'?'en':'zh');await tick();await tick();
      expect(d.querySelector('.expl').textContent).toContain(locale==='zh'?'across stocks':'横截面排名');
      expect(d.querySelector('script[src*="cdnjs"]')).toBeNull();
      expect(d.querySelector('link[href*="katex-0.19.0/katex.min.css"]')).not.toBeNull();
    }finally{dom.window.close();}
  });
});
