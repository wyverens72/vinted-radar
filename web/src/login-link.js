// A browser login token never needs to be sent to any host except this app.
export function loginCodeFromLink(value,origin){
 const input=String(value||'').trim();
 if(/^[a-f0-9]{48}$/.test(input))return input;
 let url;try{url=new URL(input);}catch{throw Error('Вставьте ссылку из кнопки «Войти на сайт» в сообщении бота.');}
 if(url.origin!==origin||url.username||url.password||url.pathname!=='/')throw Error('Нужна ссылка входа именно на этот сайт. Получите новую у бота командой /login.');
 const tokens=new URLSearchParams(url.hash.slice(1)).getAll('login');
 if(tokens.length!==1||!/^[a-f0-9]{48}$/.test(tokens[0]))throw Error('В ссылке нет данных для входа. Отправьте боту /login и скопируйте ссылку кнопки «Войти на сайт».');
 return tokens[0];
}
