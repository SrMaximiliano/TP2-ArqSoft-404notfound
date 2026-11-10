import fs from 'fs';

// Redis connection data. Terraform writes it to node/redis.json.
// The file holds the access key: it's gitignored and must never be committed.
function loadRedisConfig() {
  try {
    return JSON.parse(fs.readFileSync(new URL('./redis.json', import.meta.url), 'utf8'));
  } catch (e) {
    console.warn('redis.json not found, falling back to local Redis (localhost:6379, no TLS)');
    return { host: 'localhost', port: 6379, password: undefined, tls: false };
  }
}

export default {
  // Base uri for ARCA service
  arcaUri: 'http://10.0.4.32:8080',

  redis: loadRedisConfig(),
};
