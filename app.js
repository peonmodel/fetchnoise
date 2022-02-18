// import https from 'https';
import http from 'http';
import { exec } from 'child_process';
// https://ex55bypass.herokuapp.com/

function curlFetch(url, headers = {}, body = '') {
	const command = [
		`curl "${url}" -v`,  // always verbose to get cookie
		...Object.keys(headers).map(key => {
			return `-H "${key}: ${headers[key]}"`
		}),
		`--data-raw "${body}"`,
	].join(' ');
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) { reject(error); return; }
			resolve({ stdout, stderr });
		});
	});
}

function initialise() {
	const memo = {};
	return async function (url, { user, pass }, { refresh = 2, renew = false } = {}) {
		// memoize cookie for 1 day for given username
		if (!renew && memo[`${url}@${user}`]) {
			const stored = memo[`${url}@${user}`];
			if (stored.expiry + refresh*24*60*60*1000 > new Date().getTime()) {
				// within default 2 days
				// console.log('stored cookie', stored.value, user);
				return stored.value;
			}
			delete memo[`${url}@${user}`]; // expired
		}
		const { stderr } = await curlFetch(url, {
			'Content-Type': 'application/x-www-form-urlencoded'
		}, `user=${user}&pass=${pass}&submit=Login`); 
		const match = stderr.match(/Set-Cookie: PHPSESSID=(\w+); path=\//);
		if (!match) { console.log('stderr', stderr); throw 'cookie not found'; }
		const [ _t, cookie ] = match;
		memo[`${url}@${user}`] = { expiry: new Date().getTime(), value: cookie };
		return cookie;
	}
}

async function fetchnoise({ loginURL, dataURL, user, pass, sdate = new Date().toISOString().substring(0,10), edate = sdate }, { renew = false } = {}) {
	const cookie = await getCookie(loginURL, { user, pass }, { renew });
	const { stdout } = await curlFetch(dataURL, {
		'content-type': 'application/x-www-form-urlencoded',
		Cookie: `PHPSESSID=${cookie}`,
	}, new URLSearchParams({ sdate, edate }).toString());
	return stdout;
}
const host = '0.0.0.0';
const port = 8000;
const headers = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
	'Access-Control-Max-Age': 2592000, // 30 days
	/** add other headers as per requirement */
};

async function requestListener(req, res) {
	const buffers = [];
	req.on('data',function(chunk) {
		buffers.push(chunk);
	})
	req.on('end', async () => {
		const data = Buffer.concat(buffers).toString();
		let result = '';
		if (!data) { res.end(); return; }
		try {
			const params = JSON.parse(data);
			res.writeHead(200, headers);
			result = await fetchnoise(params);
			if (result === 'no session') {
				// probably cookie is wrong, repeat
				result = await fetchnoise(params, { renew: true });
			}
		} catch (e) {
			console.log('error', `data: ${data}`, e);
			res.writeHead(500);
		} finally {
			// if parsing result, do here
			res.end(result);
		}
  })
}
const server = http.createServer(requestListener);
const getCookie = initialise();
server.listen(port, host, () => {
	console.log(`Server is running on http://${host}:${port}`);
})
