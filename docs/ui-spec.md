# Ankix — specifica UI per il redesign

> Documento per progettare la nuova interfaccia (es. con Google Stitch). Descrive **cosa** c'è in ogni schermata, i dati mostrati, le azioni e gli stati. **Non** descrive lo stile attuale: la direzione visiva va proposta da zero.

---

## 1. Il prodotto in breve

**Ankix** è una web app per una **classe universitaria di Medicina e Chirurgia** (italiana). Gli studenti:

1. caricano i materiali del corso (slide PDF, dispense, foto degli appunti, file di testo) in una **libreria condivisa** dalla classe;
2. scelgono uno o più materiali e fanno generare all'AI (Google Gemini) un **mazzo di flashcard**;
3. rivedono e modificano le card, le ripassano nel browser e le **esportano per Anki** (l'app di ripetizione dilazionata più usata dagli studenti di medicina).

- **Lingua dell'interfaccia:** italiano.
- **Utenti:** studenti di 19–26 anni, usano l'app soprattutto da **telefono** (tra una lezione e l'altra) e da **laptop** (quando studiano).
- **Tono:** strumento di studio serio ma amichevole, non infantile e non "startup AI" generica. Deve ispirare concentrazione e fiducia, come un buon quaderno o un atlante di anatomia.

### Indicazioni per il nuovo stile

- Evitare l'estetica "AI generica": niente gradienti viola/turchese ovunque, niente icone "sparkles" sparse, niente glassmorphism di default, niente card tutte uguali con ombra morbida.
- Personalità legata al mondo della medicina e dello studio: carta, tavole anatomiche, cartelle cliniche, evidenziatori, schede di studio… (solo spunti, la scelta è libera).
- Tipografia molto leggibile: le card contengono testo lungo, formule chimiche (H₂O, Ca²⁺) ed elenchi.
- Serve una **modalità scura** completa (si studia spesso di sera).
- Accessibilità: contrasto AA, aree di tocco ≥ 44 px su mobile, stato di focus visibile.

---

## 2. Struttura e navigazione

### Mappa delle schermate

| Percorso | Schermata | Accesso |
|---|---|---|
| `/login` | Accesso | pubblico |
| `/` | Dashboard | autenticato |
| `/materiali` | Libreria materiali (+ dialog di caricamento) | autenticato |
| `/genera` | Genera flashcard (form) | autenticato |
| `/mazzi` | Elenco mazzi | autenticato |
| `/mazzi/:id` | Dettaglio mazzo (card, modifica, export) | autenticato |
| `/mazzi/:id/studia` | Modalità ripasso | autenticato |
| `/impostazioni` | Chiave Gemini personale | autenticato |
| — | 404 / errore | — |

### Layout dell'app (tutte le schermate autenticate)

**Desktop (≥ 1024 px):** barra laterale fissa a sinistra (~256 px) e contenuto a destra (larghezza massima ~1150 px).
Barra laterale:
- logo "Ankix" + nome del corso sotto (es. "Medicina e Chirurgia – I anno", può andare su 2 righe);
- voci: **Dashboard**, **Materiali**, **Genera flashcard**, **Mazzi**, **Impostazioni**;
- la voce attiva è evidenziata;
- accanto a "Impostazioni" c'è un **pallino di avviso** se lo studente non ha ancora inserito la chiave Gemini;
- in fondo, il blocco utente: avatar con le iniziali, nome ("Mario Rossi"), sottotitolo "Studente" e pulsante **Esci**.

**Mobile (< 1024 px):**
- header in alto: logo "Ankix", nome utente (troncato), icona **chiave** che porta a Impostazioni (con pallino di avviso se manca la chiave), pulsante **Esci**;
- **tab bar in basso** con 4 voci: Home, Materiali, Genera, Mazzi (icona + etichetta), rispettando la safe area dell'iPhone;
- contenuto a tutta larghezza con margini laterali di 16 px, niente scroll orizzontale.

### Elementi globali

- **Toast** (in alto al centro) per successi ed errori, con pulsante di chiusura. Alcuni toast di errore hanno un'azione, ad esempio "Chiave Gemini mancante" con il pulsante **Impostazioni**.
- **Dialog modali** per caricamento, modifica card, conferme di eliminazione: si chiudono con ESC, clic fuori o X. Su mobile vanno bene come bottom sheet.
- **Skeleton** di caricamento durante la navigazione (titolo, sottotitolo, griglia di 6 blocchi).

---

## 3. Modello dei dati (cosa si vede nelle schermate)

**Materia** — elenco fisso di 26 voci: Anatomia, Istologia, Embriologia, Biologia, Genetica, Chimica, Biochimica, Fisica, Fisiologia, Microbiologia, Immunologia, Patologia generale, Anatomia patologica, Farmacologia, Semeiotica, Medicina interna, Cardiologia, Neurologia, Chirurgia, Pediatria, Ginecologia e ostetricia, Psichiatria, Igiene e sanità pubblica, Medicina legale, Statistica medica, Altro.
Ogni materia viene mostrata come **etichetta/badge**, idealmente con un colore o simbolo distintivo per materia.

**Materiale:** titolo, materia, nome del file, tipo (PDF / immagine / testo), dimensione (es. "11,4 MB"), chi l'ha caricato, quando ("3 minuti fa").

**Mazzo:** titolo, materia, descrizione (1–2 frasi), stato (**in generazione** / **pronto** / **errore**), numero di card, materiali di origine, autore, data, modello AI usato (es. `gemini-3.6-flash`).

**Card**, di due tipi:
- **Domanda/risposta ("Basic")**: fronte (domanda), retro (risposta), extra facoltativo (nota clinica o mnemonica), tag.
- **Cloze**: una frase con parti nascoste, es. «La gittata cardiaca è il prodotto di **[frequenza cardiaca]** e **[gittata sistolica]**», più l'extra e i tag. Una cloze con 2 lacune diventa 2 card nel ripasso.
- I testi possono contenere **grassetto**, *corsivo*, pedici/apici (H₂O, Ca²⁺), elenchi puntati e piccole tabelle.
- I tag sono brevi e gerarchici: `Cuore::Conduzione`, `Emodinamica`.

---

## 4. Schermate

### 4.1 Accesso — `/login`

Schermata centrata, senza navigazione.
- Logo e nome **Ankix**, sottotitolo: «Flashcard Anki generate con l'AI dai materiali di **Medicina e Chirurgia – I anno**».
- Form:
  - **Nome e cognome** (placeholder "Mario Rossi", 2–40 caratteri);
  - **Codice di classe** (campo password);
  - pulsante primario **Entra →**.
- Stati: invio in corso (spinner nel pulsante); errore in un riquadro sotto i campi («Codice di classe non corretto.», «Troppi tentativi. Riprova tra qualche minuto.»).
- Nota a piè di pagina: «Il codice di classe è fornito dai rappresentanti del corso.»
- Non esiste registrazione: il codice è unico per la classe.

### 4.2 Dashboard — `/`

Dall'alto verso il basso:
1. **Avviso chiave Gemini** (solo se manca): «Inserisci la tua chiave Gemini — Per generare flashcard serve la tua chiave personale (gratuita su Google AI Studio).» con il pulsante **Configura**.
2. **Benvenuto:** «Ciao Mario», titolo «Trasforma le lezioni in flashcard, in pochi secondi.», sottotitolo, due azioni: **Genera flashcard** (primaria) e **Carica materiali** (secondaria).
3. **Tre numeri** cliccabili: Materiali caricati · Mazzi creati · Flashcard totali.
4. **Come funziona**, 3 passi: 1. Carica i materiali · 2. Genera le flashcard · 3. Studia con Anki (ogni passo con breve descrizione, cliccabile).
5. **Mazzi recenti:** fino a 6 *DeckCard* (vedi componenti) + link "Vedi tutti". Stato vuoto: «Ancora nessun mazzo» + pulsante **Genera il primo mazzo**.
6. **Ultimi materiali:** lista compatta di 5 righe (titolo; file · dimensione · autore · data; badge materia) + "Vedi tutti".

### 4.3 Materiali — `/materiali`

- Intestazione: titolo **Materiali**, descrizione «Slide, dispense e appunti condivisi dalla classe. Seleziona uno o più file per generare un mazzo.», pulsante **Carica materiali**.
- **Filtri:** ricerca (titolo, nome file, autore) e selettore materia ("Tutte le materie" + le materie presenti).
- **Griglia di MaterialCard** (1 colonna su mobile, 2 su tablet, 3 su desktop). Ogni card mostra:
  - una casella di **selezione** (massimo 10 materiali);
  - un'icona per il tipo di file (documento o immagine);
  - titolo (max 2 righe), nome file · dimensione;
  - badge materia, autore · data;
  - azioni: **Genera** (apre il form con questo materiale), **Apri** (scarica/visualizza in una nuova scheda), **Elimina** (solo per chi l'ha caricato, con conferma).
- **Barra di selezione flottante** (appare quando c'è almeno un materiale selezionato, sopra la tab bar su mobile): «2 selezionati» · **Annulla** · **Genera mazzo**.
- Stati: libreria vuota («Nessun materiale caricato — saranno disponibili per tutta la classe» + **Carica materiali**); nessun risultato per i filtri.
- Conferma di eliminazione: «Eliminare il materiale? **Titolo** verrà rimosso e non sarà più disponibile per nessuno. I mazzi già generati non verranno eliminati.» · Annulla / Elimina.

#### Dialog "Carica materiali"
- **Area di drop** grande: «Trascina qui i file o clicca per sceglierli» · «PDF, PNG, JPG, WEBP, HEIC, TXT, MD · max 50 MB ciascuno». Stato evidenziato quando si trascina un file sopra.
- **Lista dei file in coda**, per ognuno:
  - icona, nome, dimensione, pulsante rimuovi;
  - campo **Titolo** (precompilato dal nome del file);
  - selettore **Materia** (ricorda l'ultima scelta).
- Durante il caricamento: **barra di avanzamento** per ogni file, poi un segno di spunta (completato) o una X con il messaggio d'errore sotto (es. «File troppo grande: il limite è 50 MB.»).
- Footer: **Annulla** · **Carica (3)**. Si chiude da solo quando tutti i file sono caricati.
- Errori immediati tramite toast: formato non supportato, file vuoto, file troppo grande.

### 4.4 Genera flashcard — `/genera`

Layout su 2 colonne su desktop (form a sinistra, riepilogo "sticky" a destra); su mobile una colonna, con il riepilogo in fondo.

- Intestazione: **Genera flashcard** · «Scegli i materiali e personalizza il mazzo: Gemini farà il resto.»
- Avviso chiave Gemini se manca (come in dashboard). Senza chiave il pulsante di generazione è disattivato.

**Sezione 1 — Materiali di partenza** («Fino a 10 file. Più il materiale è mirato, migliori saranno le card.»)
- Ricerca e lista selezionabile con scroll (checkbox, icona tipo, titolo, materia · dimensione).

**Sezione 2 — Tipo di flashcard**
- **Formato**, controllo segmentato a 3 opzioni con sottotitolo: *Misto* (Domande + cloze) · *Domanda* (Fronte / retro) · *Cloze* (Testo con lacune).
- **Livello**, 3 opzioni: *Base* (Concetti chiave) · *Intermedio* (Livello esame) · *Avanzato* (Dettagli e clinica).
- **Numero di card**: slider da 5 a 100 (passo 5) con il valore mostrato ("20 card") e scorciatoie 10 / 20 / 40 / 60.

**Sezione 3 — Istruzioni aggiuntive** (facoltative): area di testo, placeholder «Es. concentrati sul ciclo cardiaco e sulle curve pressione-volume; ignora la parte storica.»

**Riepilogo (colonna destra)**
- **Titolo del mazzo** (facoltativo, placeholder «Suggerito dall'AI»).
- **Materia** (si imposta da sola in base al primo materiale scelto, modificabile).
- **Lingua delle card**: Italiano / English.
- Box con i materiali scelti: «2 materiali · 11,4 MB» + chip con i titoli.
- Pulsante primario grande **Genera 20 flashcard** (il numero segue lo slider).
- Nota: «La generazione richiede di solito da 20 secondi a un paio di minuti.»
- Dopo l'invio si apre subito la pagina del mazzo, che mostra lo stato "in generazione".

Stato vuoto (nessun materiale nella libreria): «Serve almeno un materiale» + **Vai ai materiali**.

### 4.5 Mazzi — `/mazzi`

- Intestazione: **Mazzi** · «Tutti i mazzi generati dalla classe, pronti da studiare o esportare in Anki.» · pulsante **Nuovo mazzo**.
- Filtri: ricerca, materia, interruttore **Tutti / Miei**.
- Griglia di **DeckCard**. I mazzi in generazione si aggiornano da soli.
- Stato vuoto: «Nessun mazzo ancora» + **Genera flashcard**.

### 4.6 Dettaglio mazzo — `/mazzi/:id`

È la schermata più ricca.

**Intestazione**
- Link "← Tutti i mazzi".
- Badge materia + badge di stato (vedi *StatusBadge*).
- Titolo del mazzo (grande), descrizione.
- Riga meta: «Creato da **Mario Rossi** · 3 minuti fa · `gemini-3.6-flash`».
- Chip dei materiali di origine (icona documento + titolo).
- Azioni principali (a destra su desktop, sotto il titolo su mobile): **Studia** (secondaria) e **Esporta per Anki** (primaria, scarica un file `.apkg`).

**Banner di stato** (sotto l'intestazione)
- *In generazione*: barra di avanzamento indeterminata, «Gemini sta generando le flashcard», un messaggio che cambia ogni pochi secondi («Leggo i materiali…», «Individuo i concetti ad alto rendimento…», «Scrivo domande e cloze…», «Controllo duplicati e formattazione…»), il tempo trascorso ("34s") e la nota «Puoi lasciare questa pagina: la generazione continua sul server.» Intanto al posto della lista compaiono skeleton delle card.
- *Errore*: «Generazione non riuscita» + messaggio (es. «Limite di richieste Gemini raggiunto (quota). Riprova tra qualche minuto.») + pulsante **Riprova**.
- *Chiave mancante*: avviso chiave Gemini (quando serve per riprovare o generare).

**Barra strumenti della lista**
- A sinistra: «24 card (15 domanda/risposta · 9 cloze)».
- A destra: **Aggiungi card**, **Genera altre**, **Dettagli** (modifica titolo/materia/descrizione), **CSV** (esporta), **Elimina** (solo per l'autore del mazzo).
- Ricerca nel testo delle card e filtro tipo (Tutti / Domanda-risposta / Cloze).

**Lista delle card** (vedi *CardRow*): numero progressivo, contenuto, extra, tipo, tag, azioni Modifica/Elimina.

**Dialog collegati**
- *Modifica / Nuova card* → vedi *CardEditor*.
- *Genera altre card*: «Gemini rilegge gli stessi materiali (2) ed evita le card già presenti nel mazzo.», slider "Quante card aggiungere" (5–100), area di testo "Su cosa concentrarsi", pulsante **Genera 20 card**.
- *Dettagli del mazzo*: Titolo, Materia, Descrizione; nota «In Anki il mazzo verrà importato come `Medicina::Fisiologia::Titolo`».
- Conferme: elimina card («La card verrà rimossa dal mazzo per tutta la classe.»), elimina mazzo («**Titolo** e tutte le sue 24 card verranno eliminati definitivamente.»).

### 4.7 Ripasso — `/mazzi/:id/studia`

Schermata focalizzata, larghezza contenuta (~750 px).
- Riga superiore: "← Titolo del mazzo" e pulsante **Mescola**.
- Badge materia, contatore «3 / 24» e barra di avanzamento.
- **Flashcard grande** che si gira con un'animazione (clic o barra spaziatrice):
  - fronte: etichetta "DOMANDA" (o "CLOZE 1"), testo centrato grande;
  - retro: etichetta "RISPOSTA", domanda ripetuta in piccolo, risposta grande, box "extra" (nota clinica);
  - per le cloze il fronte mostra la lacuna evidenziata «[…]» (o il suggerimento), il retro la parola rivelata ed evidenziata.
- Sotto la card: prima **Mostra risposta**, dopo il giro due pulsanti affiancati: **✕ Da ripassare** e **✓ La sapevo**.
- Link "‹ Precedente" e legenda delle scorciatoie (solo desktop): «Spazio: gira · 1/←: da ripassare · 2/→: la sapevo».
- **Schermata finale**: icona trofeo, «Sessione completata», «Hai risposto correttamente a **18** card su 24.», azioni **Ripassa le 6 sbagliate**, **Ricomincia tutto**, **Esporta per Anki**.

### 4.8 Impostazioni — `/impostazioni`

- Intestazione: **Impostazioni** · «Configura la tua chiave personale per generare flashcard con Gemini.»
- **Riquadro "Chiave API Gemini"**: icona chiave, «Ogni studente usa la propria chiave: le generazioni consumano la tua quota Google, non quella della classe.»
  - Stato *configurata*: «Chiave configurata» + chiave mascherata `AIza••••0xyz` + pulsante **Rimuovi** (con conferma).
  - Stato *mancante*: avviso «Nessuna chiave configurata: senza chiave puoi consultare, studiare ed esportare i mazzi, ma non generarne di nuovi.»
  - Campo password con pulsante **mostra/nascondi** (etichetta «Incolla la tua chiave» oppure «Sostituisci la chiave») + pulsante **Verifica e salva** (con spinner durante la verifica). Errore sotto il campo: «Chiave non valida: controlla di averla copiata per intero da Google AI Studio.»
- Due riquadri informativi affiancati:
  - **Come ottenere la chiave**: 3 passi numerati + link «Apri Google AI Studio ↗» + «Modello usato: `gemini-3.6-flash`».
  - **Privacy**: la chiave resta solo in questo browser, in un cookie cifrato · il server la usa solo durante le tue generazioni e non la salva · uscendo dall'account viene rimossa.

### 4.9 404 ed errore

- **404**: «404 · Pagina non trovata · Il contenuto che cerchi non esiste o è stato eliminato.» + **Torna alla dashboard**.
- **Errore generico**: icona di avviso, «Qualcosa è andato storto», spiegazione breve + **Riprova**.

---

## 5. Componenti

| Componente | Descrizione e varianti |
|---|---|
| **Button** | Varianti: primario, secondario (con bordo), ghost (solo testo), pericolo (rosso), versione per sfondi colorati. Taglie S / M / L. Stati: hover, focus, disabilitato, *loading* (spinner + testo). Può avere un'icona a sinistra. |
| **Input / Textarea / Select** | Etichetta sopra, suggerimento a destra dell'etichetta ("facoltativo", "20 card"), placeholder, icona interna opzionale (ricerca, utente, chiave), stato di errore. |
| **SegmentedControl** | 2–3 opzioni affiancate, ognuna con titolo e sottotitolo opzionale; una sola selezionata. |
| **Slider** | Intervallo 5–100 con il valore mostrato + chip di scorciatoia. |
| **Checkbox di selezione** | Usata su MaterialCard e nella lista del form Genera. |
| **SubjectBadge** | Etichetta della materia; colore o segno distintivo stabile per ogni materia. |
| **StatusBadge** | *In generazione* (con spinner) · *Errore* · *Ultima generazione fallita* (mazzo che ha già delle card ma l'ultima aggiunta è fallita). Lo stato *pronto* non ha badge. |
| **TypeBadge** | "BASIC" / "CLOZE", piccolo, distinguibile. |
| **Tag** | `#Conduzione_cardiaca`, piccolo e discreto. |
| **StatTile** | Numero grande + etichetta + icona, cliccabile. |
| **DeckCard** | Badge materia (+ badge di stato) · titolo (max 2 righe) · descrizione (max 2 righe) · in basso "24 card" e "Mario Rossi · 2 ore fa". Tutta la card è cliccabile. |
| **MaterialCard** | Descritta in 4.3 (selezione, icona tipo, titolo, file/dimensione, materia, autore/data, azioni Genera/Apri/Elimina). |
| **MaterialRow** | Versione compatta a una riga, per la dashboard. |
| **CardRow** | Numero · per le *basic*: domanda e risposta affiancate su desktop (divisore verticale), una sotto l'altra su mobile · per le *cloze*: frase con le parti nascoste evidenziate · extra con un segno laterale · TypeBadge + tag · azioni Modifica/Elimina (discrete, più visibili al passaggio del mouse). |
| **CardEditor** (dialog grande) | Selettore tipo *Domanda/risposta* / *Cloze* · pulsante **Anteprima** / **Modifica** · per basic: Fronte, Retro · per cloze: Testo + pulsante **"Cloze sulla selezione"** (trasforma il testo selezionato in `{{c1::testo}}`) · Extra (facoltativo) · Tag (separati da spazio) · nota sui formati consentiti · Annulla / **Salva**. L'anteprima mostra la card come nel ripasso. |
| **Flashcard (ripasso)** | Card grande con due facce e animazione di rotazione; alta almeno ~320 px su mobile e ~380 px su desktop. |
| **Banner** | Varianti: informativo/avviso (chiave mancante, con pulsante), errore (con Riprova), avanzamento (generazione in corso). |
| **EmptyState** | Icona in un riquadro, titolo, descrizione, azione. Bordo tratteggiato o simile. |
| **Modal / ConfirmDialog** | Titolo + X, contenuto scrollabile, footer con azioni (su mobile impilate a tutta larghezza). |
| **Dropzone** | Normale / trascinamento attivo / disabilitata durante il caricamento. |
| **UploadItem** | File in coda con campi Titolo e Materia, barra di avanzamento, stato ok o errore. |
| **FloatingSelectionBar** | Barra flottante con conteggio e azioni. |
| **Toast** | Successo, errore, con azione opzionale. |
| **Skeleton** | Per liste e griglie in caricamento. |
| **Avatar** | Iniziali del nome. |

---

## 6. Contenuti di esempio (per mockup realistici)

- Utente: **Mario Rossi**, classe **Medicina e Chirurgia – I anno**.
- Materiali:
  - «Fisiologia cardiaca – lezione 5» · Fisiologia · `lezione5_cuore.pdf` · 8,2 MB · Giulia Bianchi · 2 ore fa
  - «Appunti rene e nefrone» · Fisiologia · `rene.jpg` · 2,1 MB · Luca Verdi · ieri
  - «Dispensa arti superiori» · Anatomia · `arto_sup.pdf` · 11,4 MB · Mario Rossi · 3 giorni fa
- Mazzi:
  - «Fisiologia cardiaca – ciclo e conduzione» · Fisiologia · 24 card · pronto
  - «Nefrone e riassorbimento tubulare» · Fisiologia · in generazione
  - «Plesso brachiale» · Anatomia · 40 card · ultima generazione fallita
- Card:
  - Basic — **D:** Qual è il pacemaker fisiologico del cuore? **R:** Il nodo senoatriale (SA). *Extra:* frequenza intrinseca 60–100 bpm. Tag: `Conduzione_cardiaca`
  - Cloze — «La gittata cardiaca è il prodotto di **[frequenza cardiaca]** e **[gittata sistolica]**.» *Extra:* GC ≈ 5 L/min a riposo. Tag: `Emodinamica`
  - Basic — **D:** Quale ione è responsabile del plateau del potenziale d'azione miocardico? **R:** Ca²⁺ (canali di tipo L).

---

## 7. Cosa mi serve da Stitch

Per poter implementare la grafica mi bastano, per ogni schermata del capitolo 4 (in versione **desktop** e **mobile**, **chiaro** e **scuro** se possibile):
- l'HTML/CSS esportato o gli screenshot;
- la palette (colori con i codici hex), i font, i raggi degli angoli e le ombre usati;
- eventuali stati particolari disegnati (vuoto, caricamento, errore).

Le funzionalità e i testi restano quelli descritti qui: cambierò solo l'aspetto.
