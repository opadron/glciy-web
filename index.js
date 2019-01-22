
let http = require('http');
let { URL } = require('url');

let YAML = require('yaml');
let { ArgumentParser } = require('argparse');
let winston = require('winston');

let parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'Gitlab-CI-YAML Service for Spack'
});

parser.addArgument('delegates',
  { help: 'URL prefixes to query for YAML fragments', nargs: '+' });

parser.addArgument(['-b', '--bind'],
  { help: 'Hostname/IP to bind onto',
    defaultValue: 'localhost' });

parser.addArgument(['-p', '--port'],
  { help: 'Port number to listen on',
    type: 'int',
    defaultValue: 8080 });

let args = parser.parseArgs();
let delegates = args.delegates.map((d) => {
  if (!d.startsWith('http://')) {
    d = ['http://', d].join('');
  }
  return new URL(d)
});

winston.configure({
  level: 'verbose',

  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      (info) => [info.timestamp, ' ', info.level, ': ', info.message].join(''))
  ),

  transports: [new winston.transports.Console()]
});

let { info, warn, error } = winston;

const delegate = (prefix, ref) => new Promise((resolve, reject) => {
  let code, message = [];
  let req = new URL(ref, prefix);
  req.method = 'GET';
  req = http.request(req, (res) => {
      code = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (chunk) => message.push(chunk));
      res.on('end', () => resolve([code, message]));
    }
  );

  req.on('error', (e) => resolve([e.code || 500, [e.message]]));
  req.end();
}).then(([code, message]) => {
  message = message.join('')
  let result;
  if (code !== 200) {
    let exc = new Error(message);
    exc.code = code;
    throw exc;
  }

  try {
    result = YAML.parse(message);
  } catch (exc) {
    exc.code = 500;
    throw exc;
  }

  return result;
});

const combineSpec = (a, b) => {
  let { stages: stagesA = [] } = a;
  let { stages: stagesB = [] } = b;

  let nA = stagesA.length;
  let nB = stagesB.length;
  let n = nA < nB ? nB : nA;
  let i;

  let stages = [];
  let s = new Set();
  for (i=0; i<n; ++i) {
    let entry;

    if (i < nA) {
      entry = stagesA[i];
      if (!s.has(entry)) {
        stages.push(entry);
        s.add(entry);
      }
    }

    if (i < nB) {
      entry = stagesB[i];
      if (!s.has(entry)) {
        stages.push(entry);
        s.add(entry);
      }
    }
  }

  return { ...a, ...b, ...{ stages } };
};

(
  http.createServer(async (req, res) => {
    let { url } = req;

    info(`Requesting ${ url }`);

    if (!url || url === '/' || url === '') {
      url = '/develop';
    }

    let payload = await (
      Promise.all(
        delegates.map((d) => delegate(d, url)
          .catch((e) => ({})))
      ).then(
        (d) => d.reduce(combineSpec)
      ).then(YAML.stringify)
    );

    res.writeHead(200, { 'Content-Type': 'application/x-yaml' });
    res.write(payload);
    res.end();
  })

  .listen(args.port, args.bind, () => {
    info(`Listening on port ${ args.port }`);
  })
);
