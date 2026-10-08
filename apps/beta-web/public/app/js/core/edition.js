// Which edition runs, shared by the browser and the server.
//
//   true  → presentation demo: demo records on first start, fixed demo numbers
//           on Home (KPIs per quarter, pipeline), "Čekaš odgovor" examples,
//           prefilled "Novi kupac", "Vrati demo podatke" on Kupci.
//   false → clean start for real use: nothing but what the user enters.
//
// `node demo/build.ts --empty` builds the demo with this set to false.
export const DEMO_CONTENT = true;
