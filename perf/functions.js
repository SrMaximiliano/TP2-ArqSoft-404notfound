// Artillery processor: generates the "dni" field for /exchange requests.
// The dni must be a string (README: "un campo dni, de tipo texto") within 1000000..99999999.
// By default each virtual user gets a random DNI, so ARCA returns a realistic mix of
// approved and rejected validations. Export DNI=<number> to send a fixed DNI instead.
const MIN_DNI = 1000000;
const MAX_DNI = 99999999;

function setDni(context, events, done) {
  context.vars.dni =
    process.env.DNI ?? String(Math.floor(Math.random() * (MAX_DNI - MIN_DNI + 1)) + MIN_DNI);
  return done();
}

module.exports = { setDni };
