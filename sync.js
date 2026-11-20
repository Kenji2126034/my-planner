(()=>{'use strict';
/* My Planner — Google Sheets direct sync. No custom backend or OpenAI API.
 * Google access tokens are held in memory only; only public OAuth client ID,
 * spreadsheet ID and non-secret revision/fingerprint metadata are persisted.
 */
const KEY='my-planner-cloud-settings-v2';
const SCOPE='https://www.googleapis.com/auth/spreadsheets';
const TAB='PlannerData';
const HEADER=['Kind','ID','Title','Type','Date','Time','EndDate','EndTime','Category','Priority','Important','Completed','Notes','SubtasksJSON','CreatedAt','UpdatedAt','MetaJSON'];
const DEFAULT={clientId:'',spreadsheetId:'',remoteHash:'',localSignature:'',autoSync:true};
let config=readConfig(),token='',expires=0,tokenClient=null,pendingTimer=null,busy=false,authInProgress=false,initializing=false,lastStatus='local',lastError='',lastSyncedAt='',unsaved=false,interactivePending=false;
function readConfig(){try{return {...DEFAULT,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...DEFAULT}}}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(config))}catch(e){/* application local storage will still work */}}
function bridge(){return window.MyPlannerBridge}
function digest(value){const s=JSON.stringify(value);let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')+':'+s.length}
function canonical(data){return {items:(data?.items||[]).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id))),categories:(data?.categories||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)))}}
function signature(data){return digest(canonical(data))}
function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function msg(text,type){bridge()?.notify(text,type)}
function status(st,reason=''){lastStatus=st;lastError=reason;renderStatus();window.dispatchEvent(new CustomEvent('myplanner:syncstate',{detail:{status:st}}))}
function label(){if(lastStatus==='synced')return 'クラウド同期済み';if(lastStatus==='working')return '同期中…';if(lastStatus==='conflict')return '同期の競合あり';if(lastStatus==='error')return '同期エラー';if(lastStatus==='offline')return 'オフライン保存中';if(lastStatus==='dirty')return 'クラウド未反映';if(!config.clientId)return 'Google同期を設定';if(!config.spreadsheetId)return '保存先を作成';if(!token)return 'Googleへ接続';return '最新を確認'}
function renderStatus(){const text=label();for(const element of document.querySelectorAll('[data-sync-label]'))element.textContent=text;
 const pill=document.querySelector('#syncPill');if(pill){pill.dataset.syncState=lastStatus;pill.title=lastError?text+'：'+lastError:text}
 const st=document.querySelector('#syncModalStatus');if(st)st.textContent=text+(lastSyncedAt?' · 最終確認 '+lastSyncedAt:'');
 const err=document.querySelector('#syncModalError');if(err){err.textContent=lastError;err.hidden=!lastError}
}
function addLocalEvent(){let current=bridge()?.get();if(!current)return;unsaved=signature(current)!==config.localSignature;
 if(unsaved){status(token?'dirty':'local');if(token&&config.spreadsheetId&&config.autoSync){clearTimeout(pendingTimer);pendingTimer=setTimeout(()=>{sync().catch(handleError)},1700)}}}
function readableError(ex){let m=String(ex?.message||ex||'不明なエラー');if(m.includes('origin_mismatch'))return 'Google Cloudの承認済みJavaScript生成元を確認してください。';if(m.includes('403'))return 'Sheets APIの有効化・共有権限を確認してください。';if(m.includes('401'))return 'Google接続の期限が切れた可能性があります。再接続してください。';return m.slice(0,350)}
function handleError(err){console.error('MyPlanner cloud sync:',err);let reason=readableError(err);status('error',reason);msg('Google同期に失敗しました。ローカルの予定は保持されています。','error')}
function onRemoteChange(data){bridge()?.applyCloud({items:data.items,categories:data.categories});config.localSignature=signature(bridge()?.get());persist()}
function initGIS(){if(!window.google?.accounts?.oauth2)throw Error('Googleログイン用ライブラリが読み込まれていません。ネット接続を確認してください。');
 if(!config.clientId)throw Error('先にOAuthクライアントIDを設定してください。');
 tokenClient=window.google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:SCOPE,callback:response=>{
    authInProgress=false;if(response.error){handleError(new Error(response.error));return}
    token=response.access_token;expires=Date.now()+Number(response.expires_in||3500)*1000;
    status('local','');msg('Googleアカウントに接続しました');
    if(config.spreadsheetId)sync().catch(handleError);
 }})}
function connect(){if(location.protocol==='file:'){msg('Google同期にはHTTPS公開またはlocalhostでの起動が必要です。HTML単体ではローカル機能のみ使えます。','error');return}
 try{initGIS();authInProgress=true;tokenClient.requestAccessToken({prompt:'consent'});}catch(err){handleError(err)}}
async function api(path,{method='GET',body}={}){if(!token||Date.now()>expires-3000){token='';throw Error('Google接続の期限が切れました。「Googleに接続」を押してください。')}
 if(!navigator.onLine)throw Error('インターネット接続がありません。');
 const url='https://sheets.googleapis.com/v4/spreadsheets'+path;
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok){let detail='';try{let json=await response.json();detail=json.error?.message||''}catch{}throw Error('Google Sheets API '+response.status+(detail?'：'+detail:''))}
 return response.json()}
function normalizeSheetDate(value){
 if(typeof value==='number'&&value>=1&&value<110000){const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);return date.toISOString().slice(0,10)}
 const s=String(value??'').trim().replace(/\//g,'-');const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
 if(!m)return s;return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0')
}
function normalizeSheetTime(value){
 if(typeof value==='number'&&value>=0&&value<1){const min=Math.round(value*24*60);return String(Math.floor(min/60)%24).padStart(2,'0')+':'+String(min%60).padStart(2,'0')}
 const s=String(value??'').trim();if(!s)return '';let m=s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);return m?m[1].padStart(2,'0')+':'+m[2]:s
}
function normalizedBool(value){return value===true||value===1||['true','yes','1','済','完了'].includes(String(value||'').trim().toLowerCase())}
function parseRows(values){let rows=Array.isArray(values)?values:[];
 if(!rows.length)return {items:[],categories:[],settings:{},isEmpty:true,rowsCount:0,hash:digest([])};
 if(String(rows[0]?.[0])!=='Kind'||String(rows[0]?.[1])!=='ID')throw Error('対象シートの形式が異なります。新しいPlannerDataタブを作成するか、別のシートIDを設定してください。');
 let items=[],categories=[],settings={},errors=[];
 for(let i=1;i<rows.length;i++){let row=rows[i];if(!row||!row[0])continue;const kind=String(row[0]);
 if(kind==='categories'){try{const parsed=JSON.parse(row[16]||'[]');if(Array.isArray(parsed))categories=parsed}catch{errors.push(i+1)}continue}
 if(kind==='settings'){try{settings=JSON.parse(row[16]||'{}')}catch{errors.push(i+1)}continue}
 if(kind!=='item')continue;
 let [_,taskId,title,type,date,time,endDate,endTime,category,priority,important,completed,notes,subJSON,createdAt,updatedAt]=row;
 if(!title||typeof title!=='string')continue;
 let subtasks=[];try{let parsed=JSON.parse(subJSON||'[]');if(Array.isArray(parsed))subtasks=parsed}catch{errors.push(i+1)}
 items.push({id:String(taskId||crypto.randomUUID()),title:String(title).slice(0,160),type:type==='event'?'event':'task',date:normalizeSheetDate(date),time:normalizeSheetTime(time),endDate:normalizeSheetDate(endDate),endTime:normalizeSheetTime(endTime),category:String(category||'就活'),priority:['high','normal','low'].includes(priority)?priority:'normal',important:normalizedBool(important),completed:normalizedBool(completed),notes:String(notes||''),subtasks,createdAt:String(createdAt||new Date().toISOString()),updatedAt:String(updatedAt||new Date().toISOString())});
 }
 if(errors.length)throw Error('保存先の '+errors.join(', ')+' 行にJSONの読み取りエラーがあります。スプレッドシートを確認してください。');
 if(!categories.length){categories=[{name:'就活',color:'#4776d5',icon:'briefcase'},{name:'研究',color:'#9a70cf',icon:'book'},{name:'大学',color:'#dc9852',icon:'folder'},{name:'生活',color:'#26a391',icon:'heart'}]}
 for(const item of items)if(!categories.some(c=>c.name===item.category))categories.push({name:item.category,color:'#7b8cae',icon:'folder'});
 return {items,categories,settings,isEmpty:false,rowsCount:rows.length,hash:digest(rows)};
}
function serializeRows(data){let a=[HEADER, ['meta','planner','','','','','','','','','','','','','','',JSON.stringify({format:'MyPlannerSheet',version:2,updatedAt:new Date().toISOString()})],['categories','list','','','','','','','','','','','','','','',JSON.stringify(data.categories||[])],['settings','local','','','','','','','','','','','','','','',JSON.stringify({version:2})]];
 for(const t of data.items){a.push(['item',String(t.id),String(t.title),t.type||'task',t.date||'',t.time||'',t.endDate||'',t.endTime||'',t.category||'就活',t.priority||'normal',!!t.important,!!t.completed,t.notes||'',JSON.stringify(t.subtasks||[]),t.createdAt||'',t.updatedAt||'',''])}
 return a}
async function readRemote(){if(!config.spreadsheetId)throw Error('スプレッドシートIDが未設定です。');
 const path='/'+encodeURIComponent(config.spreadsheetId)+'/values/'+encodeURIComponent(TAB+'!A1:Q')+'?valueRenderOption=UNFORMATTED_VALUE';
 const json=await api(path);return parseRows(json.values)}
async function writeRemote(data,remote){const rows=serializeRows(data);
 if(rows.length>10000)throw Error('タスクが多すぎます。1万件以下にしてください。');
 const size=Math.max(rows.length,remote?.rowsCount||0);
 while(rows.length<size)rows.push(Array(17).fill(''));
 const range=TAB+'!A1:Q'+size;
 const path='/'+encodeURIComponent(config.spreadsheetId)+'/values/'+encodeURIComponent(range)+'?valueInputOption=RAW';
 await api(path,{method:'PUT',body:{range,majorDimension:'ROWS',values:rows}});
 const reread=await readRemote();config.remoteHash=reread.hash;config.localSignature=signature(data);persist();unsaved=false;lastSyncedAt=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});status('synced','');return reread;
}
function ensureBackup(){const snapshot=bridge()?.get();if(!snapshot)return;
 const str=JSON.stringify({format:'MyPlanner',version:1,exportedAt:new Date().toISOString(),...snapshot},null,2);
 const blob=new Blob([str],{type:'application/json'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='MyPlanner_beforeCloudRestore_'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function sync({force=false}={}){if(busy)return;if(!config.clientId||!config.spreadsheetId)return;
 if(!token||Date.now()>=expires-3000){status('offline','Google接続の再認証が必要です');return}
 busy=true;status('working','');
 try{
  const remote=await readRemote();const local=bridge()?.get();if(!local)throw Error('アプリデータを取得できません。');
  const sig=signature(local),dirty=sig!==config.localSignature;
  if(remote.isEmpty){if(config.remoteHash){status('conflict','保存先のデータが消えている可能性があります。自動上書きは行いません。');return}await writeRemote(local,remote);return}
  if(config.remoteHash===''){ // first time linking to a populated sheet
    if(remote.items.length&&!force){status('conflict','保存先には既存のデータがあります。まず「クラウドから読み込む」を選んでください。');return}
    if(!remote.items.length){await writeRemote(local,remote);return}
  }
  const changed=remote.hash!==config.remoteHash;
  if(changed&&dirty){status('conflict','この端末とクラウドの両方が変更されています。両方をJSONでバックアップし、どちらを採用するか選んでください。');return}
  if(changed){onRemoteChange(remote);config.remoteHash=remote.hash;config.localSignature=signature(bridge()?.get());persist();unsaved=false;lastSyncedAt=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});status('synced','');msg('クラウドの最新データを読み込みました');return}
  if(dirty){await writeRemote(local,remote);return}
  lastSyncedAt=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});status('synced','');
 }catch(err){handleError(err)}finally{busy=false}}
async function pull({prompt=true}={}){if(busy)return;if(!config.spreadsheetId||!token){msg('先にGoogle接続と保存先の設定を行ってください。','error');return}busy=true;status('working','');
 try{let remote=await readRemote();if(remote.isEmpty){status('local','クラウドは空です。先に端末データを保存できます。');msg('クラウドはまだ空です');return}
  if(prompt&&!window.confirm('クラウドの予定をこの端末へ読み込みます。現在の端末データはJSONバックアップとして自動ダウンロードされます。続行しますか？')){status('local');return}
  ensureBackup();onRemoteChange(remote);config.remoteHash=remote.hash;config.localSignature=signature(bridge()?.get());persist();unsaved=false;lastSyncedAt=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});status('synced','');msg('クラウドから取り込みました');
 }catch(err){handleError(err)}finally{busy=false}}
async function push({prompt=true}={}){if(busy)return;if(!token||!config.spreadsheetId){msg('先にGoogle接続と保存先の設定を行ってください。','error');return}busy=true;status('working','');
 try{let remote=await readRemote();if(remote.hash!==config.remoteHash&&config.remoteHash){status('conflict','クラウド側に変更があります。クラウドを読み込むか、明示的に上書きしてください。');return}
 if(remote.items.length&&config.remoteHash===''){status('conflict','保存先に既存データがあります。初回はクラウド読み込みをおすすめします。');return}
 if(prompt&&!window.confirm('この端末のデータをGoogleスプレッドシートへ保存します。続行しますか？')){status('local');return}
 await writeRemote(bridge().get(),remote);msg('Googleスプレッドシートに保存しました');
 }catch(err){handleError(err)}finally{busy=false}}
async function overwrite(){if(!token||!config.spreadsheetId){msg('先にGoogleに接続してください。','error');return}
 if(!window.confirm('注意：クラウド上のすべての予定を、この端末の内容で置き換えます。別端末の変更が消える可能性があります。本当に続行しますか？'))return;
 if(!window.confirm('最終確認です。既存クラウドデータを上書きしますか？'))return;
 if(busy)return;busy=true;status('working');
 try{let remote=await readRemote();await writeRemote(bridge().get(),remote);msg('クラウドのデータを上書きしました')}catch(e){handleError(e)}finally{busy=false}}
async function create(){if(busy)return;if(!token){msg('先にGoogleに接続してください。','error');return}
 if(config.spreadsheetId&&!window.confirm('現在のシート接続を解除し、新しいスプレッドシートを作りますか？'))return;
 busy=true;status('working','');
 try{const result=await api('',{method:'POST',body:{properties:{title:'My Planner｜予定データ',locale:'ja_JP',timeZone:'Asia/Tokyo'},sheets:[{properties:{title:TAB,gridProperties:{rowCount:10000,columnCount:17,frozenRowCount:1}}}]}});
 const sid=result.spreadsheetId;if(!sid)throw Error('作成されたシートIDを確認できません');
 config.spreadsheetId=sid;config.remoteHash='';config.localSignature='';persist();let empty=await readRemote();await writeRemote(bridge().get(),empty);msg('保存用スプレッドシートを作成し、予定を保存しました');window.open('https://docs.google.com/spreadsheets/d/'+sid+'/edit','_blank','noopener');renderStatus();
 }catch(err){handleError(err)}finally{busy=false}}
function saveOptions(){const client=document.querySelector('#cloudClientId')?.value.trim()||'';const sheet=document.querySelector('#cloudSheetId')?.value.trim()||'';const auto=!!document.querySelector('#cloudAutoSync')?.checked;
 if(client&&!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(client)){msg('OAuthクライアントIDの形式を確認してください。','error');return}
 let sid=sheet;const m=sheet.match(/spreadsheets\/d\/([\w-]+)/);if(m)sid=m[1];
 if(sid&&!/^[\w-]{15,}$/.test(sid)){msg('スプレッドシートIDまたはURLを確認してください。','error');return}
 if(config.clientId!==client){token='';tokenClient=null}
 if(config.spreadsheetId!==sid){config.remoteHash='';config.localSignature=''}
 Object.assign(config,{clientId:client,spreadsheetId:sid,autoSync:auto});persist();status('local','');renderStatus();msg('Google同期の設定を保存しました')}
function disconnect(){if(!window.confirm('Google同期を解除しますか？端末の予定は残ります。'))return;
 if(token&&window.google?.accounts?.oauth2?.revoke)try{window.google.accounts.oauth2.revoke(token,()=>{})}catch{}token='';expires=0;tokenClient=null;config={...DEFAULT};persist();status('local','');msg('同期を解除しました。端末データは残っています。')}
function html(){return `<div class="sync-intro"><strong>Googleスプレッドシート同期</strong><p>OpenAI API・独自サーバー不要。Google Sheetsを保存先として、PCとスマホで同じ予定を扱えます。保存データはGoogleアカウント内に置かれます。</p>
<details class="sync-advanced"><summary>初めて設定する方：手順を見る</summary><p>① このアプリをGitHub Pages等のHTTPSサイトで公開<br>② <a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener noreferrer">Google Sheets APIを有効化</a><br>③ <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Google Auth PlatformでOAuthクライアントIDを作成</a>（種類：ウェブアプリ）<br>④ 承認済みJavaScript生成元に公開したURLのオリジンを登録<br>⑤ この画面にClient IDを貼付 → 設定を保存 → Googleに接続 → 保存用シートを新規作成<br>⑥ 別端末でも同じClient IDとスプレッドシートIDを使う<br>※ 詳細な説明はZIP同梱READMEに記載しています。</p></details></div>
 <div class="cloud-status"><span class="sync-led"></span><span id="syncModalStatus">${escapeHTML(label())}</span></div><p id="syncModalError" class="sync-error" ${lastError?'':'hidden'}>${escapeHTML(lastError)}</p>
 <div class="field"><label for="cloudClientId">Google OAuth 2.0 クライアントID</label><input id="cloudClientId" type="text" autocomplete="off" spellcheck="false" placeholder="xxxxx.apps.googleusercontent.com" value="${escapeHTML(config.clientId)}"><small>Google Cloudで「ウェブアプリケーション」のOAuthクライアントを作成してください。Client IDは秘密鍵ではありません。</small></div>
 <div class="field"><label for="cloudSheetId">保存先スプレッドシートID（初回は空欄でOK）</label><input id="cloudSheetId" type="text" autocomplete="off" spellcheck="false" placeholder="Googleに接続後「新規作成」が可能" value="${escapeHTML(config.spreadsheetId)}"><small>既存の「My Planner｜予定データ」を使う場合はURLを貼り付けてもOKです。</small></div>
 <label class="cloud-checkbox"><input type="checkbox" id="cloudAutoSync" ${config.autoSync?'checked':''}><span>編集後に自動保存する（競合時は停止）</span></label>
 <div class="sync-toolbar"><button class="btn primary" data-action="sync-save">設定を保存</button><button class="btn" data-action="sync-login">Googleに接続</button><button class="btn" data-action="sync-create">保存用シートを新規作成</button></div>
 <div class="sync-toolbar"><button class="btn" data-action="sync-now">最新状態を同期</button><button class="btn" data-action="sync-pull">クラウドから読み込む</button><button class="btn" data-action="sync-push">端末から保存</button></div>
 <details class="sync-advanced"><summary>競合解決・接続解除</summary><p>両方が変更された場合、アプリは勝手に上書きしません。JSONバックアップを保存してから一方を選んでください。</p><button class="btn danger" data-action="sync-overwrite">この端末の内容でクラウドを強制上書き</button><button class="btn" data-action="sync-disconnect">Google同期を解除</button></details>
 ${config.spreadsheetId?`<p class="cloud-link"><a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.spreadsheetId)}/edit" target="_blank" rel="noopener noreferrer">保存先のGoogleスプレッドシートを開く ↗</a></p>`:''}
 <div class="info-card">${location.protocol==='file:'?'<strong>現在はローカルHTMLで開いています。Google同期にはHTTPS上のアプリ（GitHub Pagesなど）またはlocalhostが必要です。</strong><br>':''}Googleカレンダーへの連携はありません。Googleアカウントの許可画面で「スプレッドシートの表示と編集」を承認します。<br>Googleは、このアプリが作成・利用するファイルのアクセス許可を求めます。ログインが期限切れになった場合は「Googleに接続」を押してください。</div>`}
function onAction(action){switch(action){case'sync-save':saveOptions();break;case'sync-login':connect();break;case'sync-create':create();break;case'sync-now':sync();break;case'sync-pull':pull();break;case'sync-push':push();break;case'sync-overwrite':overwrite();break;case'sync-disconnect':disconnect();break;}}
function onRender(){renderStatus()}
function onInit(){window.addEventListener('myplanner:localchange',addLocalEvent);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&token&&config.spreadsheetId&&!busy)sync().catch(handleError)});
 window.setInterval(()=>{if(document.visibilityState==='visible'&&token&&config.spreadsheetId&&!busy)sync().catch(handleError)},90000);
 unsaved=signature(bridge()?.get())!==config.localSignature;status(!config.clientId?'local':'offline','');
 // Google login is deliberately not triggered on page load without user gesture.
}
window.MyPlannerSync={html,onAction,onRender,connect,sync,pull,push,create,saveOptions,digest,parseRows,serializeRows,signature,getState:()=>({status:lastStatus,config:{...config},authenticated:!!token,unsaved,lastError})};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',onInit);else onInit();
})();