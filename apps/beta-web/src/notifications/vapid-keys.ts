// Prints a new VAPID key pair for .env (push reminders). Run once per deployment:
//   pnpm --filter @renvara/beta-web push:keys
// Keep the private key secret: it is the server's identity towards the push services.
import { generateVapidKeys } from './web-push.ts';

const { publicKey, privateKey } = generateVapidKeys();
console.log(`RENVARA_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`RENVARA_VAPID_PRIVATE_KEY=${privateKey}`);
console.log('RENVARA_VAPID_SUBJECT=mailto:you@example.com');
