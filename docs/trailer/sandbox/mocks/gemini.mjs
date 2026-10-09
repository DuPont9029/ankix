// Fake Gemini API for the trailer sandbox: canned answers, picked by the JSON schema of each request.
import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = +(process.env.PORT || 9200);
const WORK = process.env.TRAILER_WORK ?? new URL("../work", import.meta.url).pathname;
const BOXES = JSON.parse(readFileSync(`${WORK}/assets/nephron-boxes.json`, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const card = (type, front, back, extra, tags) => ({ type, front, back, extra, tags, choices: [], answer_index: -1 });

const DECK = {
  title: "Renal Physiology · The Nephron",
  description: "Glomerular filtration, tubular reabsorption, urine concentration and hormonal control.",
  cards: [
    card("basic", "Where is most of the filtered Na⁺ reabsorbed?", "In the proximal convoluted tubule (about 65%)", "Water, glucose and amino acids follow.", ["tubule"]),
    card("cloze", "ADH inserts {{c1::aquaporin-2}} channels into the membrane of the {{c2::collecting duct}}.", "", "Acts on V2 receptors.", ["ADH"]),
    card("basic", "What is a normal GFR?", "About 125 mL/min (≈ 180 L/day)", "", ["filtration"]),
    card("cloze", "Renin is secreted by the {{c1::juxtaglomerular}} cells of the afferent arteriole.", "", "Trigger: low renal perfusion pressure.", ["RAAS"]),
    card("basic", "What does aldosterone do in the collecting duct?", "Increases Na⁺ reabsorption and K⁺ secretion", "", ["RAAS"]),
    card("basic", "What does creatinine clearance estimate?", "The glomerular filtration rate", "", ["filtration"]),
    card("cloze", "The {{c1::descending}} limb of the loop of Henle is permeable to water, the {{c2::ascending}} limb is not.", "", "", ["loop of Henle"]),
    card("basic", "Which transporter reabsorbs NaCl in the thick ascending limb?", "The Na⁺-K⁺-2Cl⁻ cotransporter (NKCC2)", "Target of loop diuretics.", ["loop of Henle"]),
    card("basic", "What is countercurrent multiplication?", "The loop of Henle mechanism that builds the medullary osmotic gradient", "", ["concentration"]),
    card("cloze", "{{c1::Urea recycling}} adds to the osmolarity of the inner medulla.", "", "", ["concentration"]),
    card("basic", "Where does tubuloglomerular feedback act?", "At the macula densa, which matches GFR to the distal NaCl load", "", ["regulation"]),
    card("basic", "Which forces drive glomerular filtration?", "Starling forces: capillary hydrostatic pressure against oncotic pressure and Bowman's capsule pressure", "", ["filtration"]),
    card("basic", "What is the renal threshold for glucose?", "About 180 mg/dL of plasma glucose", "Above it, glucosuria appears.", ["tubule"]),
    card("basic", "How is glucose reabsorbed in the proximal tubule?", "By the Na⁺-glucose cotransporter SGLT2 on the apical side", "Target of gliflozins.", ["tubule"]),
    card("cloze", "{{c1::Thiazide}} diuretics block the Na⁺-Cl⁻ cotransporter of the distal tubule.", "", "", ["diuretics"]),
    card("basic", "Where does furosemide act?", "On the Na⁺-K⁺-2Cl⁻ cotransporter of the thick ascending limb", "", ["diuretics"]),
    card("basic", "What does spironolactone do?", "Blocks the mineralocorticoid receptor: a potassium-sparing diuretic", "", ["diuretics"]),
    card("cloze", "Angiotensin II stimulates {{c1::aldosterone}} release from the zona glomerulosa.", "", "", ["RAAS"]),
    card("basic", "Which enzyme converts angiotensin I to angiotensin II?", "Angiotensin-converting enzyme (ACE), mainly in the lungs", "", ["RAAS"]),
    card("basic", "What is the maximum urine osmolarity in humans?", "About 1200 mOsm/L", "", ["concentration"]),
    card("basic", "What is the minimum urine osmolarity?", "About 50 mOsm/L, without ADH", "", ["concentration"]),
    card("cloze", "The vasa recta preserve the medullary gradient by {{c1::countercurrent exchange}}.", "", "", ["concentration"]),
    card("basic", "Where are the V2 receptors for ADH?", "On the principal cells of the collecting duct", "", ["ADH"]),
    card("basic", "What is the strongest stimulus for ADH release?", "A rise in plasma osmolarity", "", ["ADH"]),
    card("cloze", "{{c1::Central}} diabetes insipidus is caused by a lack of ADH secretion.", "", "", ["ADH"]),
    card("basic", "What does PAH clearance measure?", "Effective renal plasma flow", "", ["clearance"]),
    card("basic", "What is the filtration fraction?", "GFR divided by renal plasma flow, about 20%", "", ["filtration"]),
    card("cloze", "{{c1::Myogenic autoregulation}} keeps GFR stable when arterial pressure changes.", "", "", ["regulation"]),
    card("basic", "How does the kidney respond to metabolic acidosis?", "It excretes more H⁺ and makes new bicarbonate (ammoniagenesis)", "", ["acid-base"]),
    card("basic", "Where is most filtered bicarbonate reabsorbed?", "In the proximal convoluted tubule", "", ["acid-base"]),
    card("cloze", "{{c1::Type A intercalated}} cells of the collecting duct secrete H⁺.", "", "", ["acid-base"]),
    card("basic", "What does atrial natriuretic peptide (ANP) do?", "Increases sodium excretion and GFR, opposing the RAAS", "", ["regulation"]),
    card("basic", "Which renal hormone stimulates red blood cell production?", "Erythropoietin, made by peritubular fibroblasts", "", ["endocrine"]),
    card("cloze", "The kidney converts calcidiol to {{c1::calcitriol}} through 1α-hydroxylase.", "", "", ["endocrine"]),
    card("basic", "Where is potassium secreted in the nephron?", "By the principal cells of the distal tubule and collecting duct", "", ["potassium"]),
    card("basic", "How does hyperkalaemia affect aldosterone?", "It stimulates aldosterone release directly", "", ["potassium"]),
    card("cloze", "The filtration barrier is made of fenestrated endothelium, basement membrane and {{c1::podocytes}}.", "", "", ["filtration"]),
    card("basic", "Why does albumin normally not enter the filtrate?", "Because of its size and the negative charge of the filtration barrier", "", ["filtration"]),
    card("basic", "What is the macula densa?", "Distal tubule cells that sense NaCl and regulate GFR and renin", "", ["regulation"]),
    card("basic", "How much urine is produced per day?", "About 1–1.5 L", "", ["concentration"]),
  ],
};

const OCCLUSION = {
  header: "Identify the structures of the nephron",
  back_extra: "The filtrate flows from Bowman's capsule to the collecting duct.",
  tags: ["nephron", "anatomy"],
  masks: BOXES,
};

const MIND = {
  title: "The kidney",
  nodes: [
    { id: "n1", label: "Renal physiology", note: "", parent: "", cards: [] },
    { id: "n2", label: "Filtration", note: "", parent: "n1", cards: [3, 6, 12] },
    { id: "n3", label: "GFR 125 mL/min", note: "", parent: "n2", cards: [3] },
    { id: "n4", label: "Starling forces", note: "", parent: "n2", cards: [12] },
    { id: "n5", label: "Creatinine clearance", note: "", parent: "n2", cards: [6] },
    { id: "n6", label: "Reabsorption", note: "", parent: "n1", cards: [1, 8] },
    { id: "n7", label: "Proximal tubule", note: "", parent: "n6", cards: [1] },
    { id: "n8", label: "NKCC2", note: "", parent: "n6", cards: [8] },
    { id: "n9", label: "Concentration", note: "", parent: "n1", cards: [7, 9, 10] },
    { id: "n10", label: "Countercurrent", note: "", parent: "n9", cards: [9] },
    { id: "n11", label: "Urea recycling", note: "", parent: "n9", cards: [10] },
    { id: "n12", label: "Regulation", note: "", parent: "n1", cards: [2, 4, 5, 11] },
    { id: "n13", label: "ADH", note: "", parent: "n12", cards: [2] },
    { id: "n14", label: "Renin", note: "", parent: "n12", cards: [4] },
    { id: "n15", label: "Aldosterone", note: "", parent: "n12", cards: [5] },
    { id: "n16", label: "Macula densa", note: "", parent: "n12", cards: [11] },
  ],
};

const CONCEPT = {
  focus_question: "How does the kidney control water and sodium?",
  concepts: [
    { id: "c1", label: "Kidney", level: 0, note: "", cards: [] },
    { id: "c2", label: "Nephron", level: 1, note: "", cards: [1] },
    { id: "c3", label: "Hormones", level: 1, note: "", cards: [4, 5] },
    { id: "c4", label: "Glomerulus", level: 2, note: "", cards: [3] },
    { id: "c5", label: "Tubules", level: 2, note: "", cards: [1, 8] },
    { id: "c6", label: "ADH", level: 2, note: "", cards: [2] },
    { id: "c7", label: "Aldosterone", level: 2, note: "", cards: [5] },
    { id: "c8", label: "Filtrate", level: 3, note: "", cards: [3, 12] },
    { id: "c9", label: "Water", level: 3, note: "", cards: [2, 7] },
    { id: "c10", label: "Sodium", level: 3, note: "", cards: [1, 5] },
  ],
  propositions: [
    { from: "c1", linking_words: "is made of", to: "c2", cross_link: false, cards: [] },
    { from: "c1", linking_words: "is regulated by", to: "c3", cross_link: false, cards: [] },
    { from: "c2", linking_words: "includes the", to: "c4", cross_link: false, cards: [3] },
    { from: "c2", linking_words: "includes the", to: "c5", cross_link: false, cards: [1] },
    { from: "c3", linking_words: "such as", to: "c6", cross_link: false, cards: [2] },
    { from: "c3", linking_words: "such as", to: "c7", cross_link: false, cards: [5] },
    { from: "c4", linking_words: "produces the", to: "c8", cross_link: false, cards: [3] },
    { from: "c6", linking_words: "retains", to: "c9", cross_link: false, cards: [2] },
    { from: "c7", linking_words: "retains", to: "c10", cross_link: false, cards: [5] },
    { from: "c5", linking_words: "reabsorb", to: "c10", cross_link: true, cards: [1] },
  ],
};

const QUESTIONS = [
  ["Describe how the kidney concentrates urine.", "Urine concentration"],
  ["How is the glomerular filtration rate regulated?", "Glomerular filtration"],
  ["What is the role of ADH in water balance?", "ADH"],
  ["Describe the renin-angiotensin-aldosterone system.", "RAAS"],
  ["What does the proximal convoluted tubule reabsorb?", "Tubular reabsorption"],
  ["What is renal clearance and what is it used for?", "Clearance"],
  ["Explain tubuloglomerular feedback.", "Macula densa"],
  ["Which forces determine glomerular filtration?", "Starling forces"],
  ["What is the role of urea recycling?", "Renal medulla"],
  ["How do loop diuretics work?", "Loop of Henle"],
  ["What stimulates renin secretion?", "Renin"],
  ["What happens without ADH?", "Diabetes insipidus"],
].map(([question, topic]) => ({ question, topic }));

function exam(nAnswers) {
  const fb = [
    ["good", "You explained countercurrent multiplication well and the different permeability of the two limbs."],
    ["partial", "The role of the macula densa is right, but myogenic autoregulation of the afferent arteriole is missing."],
    ["good", "Clear link between ADH, V2 receptors and aquaporin-2."],
  ];
  return {
    grade: 28,
    honors: false,
    summary:
      "A clear, well-structured answer with accurate terminology. Urine concentration is explained thoroughly; on GFR regulation, myogenic autoregulation is missing and tubuloglomerular feedback is described imprecisely.",
    criteria: { accuracy: 9, completeness: 7, clarity: 9, terminology: 8 },
    strengths: ["Countercurrent multiplication explained step by step", "Role of ADH and aquaporin-2", "Precise medical vocabulary"],
    improvements: ["Review myogenic autoregulation of GFR", "Connect the macula densa to the RAAS", "Mention urea recycling in the medulla"],
    errors: [{ said: "The macula densa secretes renin", correction: "Renin is secreted by juxtaglomerular cells; the macula densa senses NaCl in the distal tubule." }],
    answers: Array.from({ length: nAnswers }, (_, i) => ({ coverage: fb[i % 3][0], feedback: fb[i % 3][1] })),
    topics: [
      { topic: "Countercurrent multiplication", coverage: "good", comment: "Complete and correct.", cards: [9, 7], new_cards: [] },
      { topic: "Role of ADH", coverage: "good", comment: "Correct mechanism through aquaporin-2.", cards: [2], new_cards: [] },
      { topic: "Urea recycling", coverage: "partial", comment: "Mentioned but not explained.", cards: [10], new_cards: [] },
      {
        topic: "Tubuloglomerular feedback",
        coverage: "poor",
        comment: "Confused the macula densa with renin secretion.",
        cards: [11, 4],
        new_cards: [card("basic", "What does the macula densa sense?", "The NaCl concentration in the distal tubule", "", ["regulation"])],
      },
      {
        topic: "Myogenic autoregulation",
        coverage: "missing",
        comment: "Not mentioned.",
        cards: [],
        new_cards: [card("basic", "What is myogenic autoregulation of GFR?", "Constriction of the afferent arteriole when pressure rises, keeping GFR stable", "", ["filtration"])],
      },
    ],
  };
}

const TRANSCRIPT =
  "So, urine concentration depends on the loop of Henle, which builds an osmotic gradient in the medulla through countercurrent multiplication. The descending limb is permeable to water, while the thick ascending limb is not and pumps out sodium and chloride with the cotransporter. Then ADH acts on the collecting duct and inserts aquaporin-2 channels, so water is reabsorbed and the urine becomes more concentrated.";

function reply(res, obj, text) {
  const body = { candidates: [{ content: { role: "model", parts: [{ text: text ?? JSON.stringify(obj) }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 } };
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      const raw = Buffer.concat(chunks).toString("utf8");
      if (req.method === "GET" && /\/models\/[^/:]+$/.test(url.pathname)) {
        const name = url.pathname.split("/").pop();
        console.log("verify", name);
        return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ name: `models/${name}`, displayName: name, inputTokenLimit: 1048576, outputTokenLimit: 65536 }));
      }
      if (req.method === "POST" && url.pathname.endsWith(":generateContent")) {
        const schema = raw.match(/"responseJsonSchema"|"responseSchema"/) ? raw : "";
        const has = (k) => schema.includes(`"${k}"`);
        await sleep(1500);
        if (!schema) { console.log("transcribe"); return reply(res, null, TRANSCRIPT); }
        if (has("grade")) {
          const n = Math.max(1, QUESTIONS.filter((q) => raw.includes(q.question)).length) || 3;
          console.log("exam evaluation", n);
          return reply(res, exam(n));
        }
        if (has("questions")) { console.log("exam questions"); return reply(res, { questions: QUESTIONS }); }
        if (has("masks")) { console.log("occlusion"); return reply(res, OCCLUSION); }
        if (has("propositions")) { console.log("concept map"); return reply(res, CONCEPT); }
        if (has("nodes")) { console.log("mind map"); return reply(res, MIND); }
        if (has("cards")) { console.log("deck"); return reply(res, DECK); }
        console.log("UNKNOWN schema request", raw.slice(0, 400));
        return reply(res, {});
      }
      console.log("UNHANDLED", req.method, url.pathname);
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: 404, message: "not found", status: "NOT_FOUND" } }));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Gemini on :${PORT}`));
