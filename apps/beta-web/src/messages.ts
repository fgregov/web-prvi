/** User-facing Croatian messages returned by the API. Kept in one place so the UI stays consistent. */
export const MESSAGES = {
  invalidCredentials: 'Neispravno korisničko ime ili lozinka.',
  missingCredentials: 'Unesite korisničko ime i lozinku.',
  badRequest: 'Neispravan zahtjev.',
  tooManyAttempts: 'Previše neuspjelih pokušaja. Pokušajte ponovno za minutu.',
  serverError: 'Došlo je do pogreške. Pokušajte ponovno.',
} as const;
