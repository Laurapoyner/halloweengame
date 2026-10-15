# Heksens Trylledrik 🧪

En Halloween-skattejagt for børn, der kører i telefonens browser. Hvert hold får en telefon og skal fylde tre ting på heksens hylde. Spillet er færdigt, når alle tre er fyldt. For hver løst opgave dukker et bogstav op i det hemmelige kodeord, i tilfældig rækkefølge.

| Hvad fyldes | Opgaver |
|---|---|
| 🧪 **Trylledrikken** | 9 fotoopgaver rundt i huset (farver, mørke, lys, mumie, edderkop, zombier …) |
| 👻 **Spøgelsesglasset** | 3 væsner, der findes med spøgelsesmåleren (spøgelse, kat, skelet – hver fanges på sin måde), og **edderkoppejagten** med 10 edderkopper. Ingen kort er nødvendige |
| 🌕 **Fuldmånen** | 3 bevægelsesopgaver i det magiske spejl med heksehat på: 10 sprællemænd pr. barn, 10 flagermus pr. barn, og stå stille som sten |

## Før legen (til den voksne)

1. Åbn **Voksen-menu** nederst. Koden er `1031`.
2. Tryk på holdnavnet øverst, og skriv, hvor mange børn der er på holdet. Det styrer antallet af sprællemænd og flagermus (10 hver).

**Spøgelsesmåleren** virker som "varm og kold".
- Telefonen tæller skridt og ved, hvilken vej den peger. Væsenet gemmer sig 5–11 meter væk i en tilfældig retning.
- Jo tættere børnene går på, jo mere slår måleren og lyden ud, og stemmen siger "Varmere!" eller "Koldere!".
- Kan de ikke komme frem (fx på grund af en væg), kommer væsenet selv langsomt nærmere efter 45 sekunder.
- Helt tæt på dukker væsenet op i kameraet, og så fanges det hver sin måde:
  - **Spøgelset:** tryk på det 3 gange, mens det flygter rundt i rummet.
  - **Katten:** den løber, og børnene skal følge den med kameraet og holde den i sigtet i 4 sekunder.
  - **Skelettet:** det falder fra hinanden, og børnene skal finde de 5 knogler rundt omkring og trykke på dem.

**Edderkoppejagten:**
- Telefonens bevægelsessensor ved, hvilken vej kameraet peger, så edderkopperne "hænger" rundt om børnene i rummet.
- En pil viser vejen til den næste edderkop.
- Når edderkoppen holdes i midten af sigtet, bliver den fanget.
- Mellem hver edderkop skal børnene gå et stykke, før den næste kravler frem.
- På iPhone skal man give lov til "bevægelse og retning", når telefonen spørger. Det gælder alle jagterne.
- Hold telefonen foran jer, når I går. Så tæller skridttælleren bedst.

**Driller en opgave?**
- Der er et "Voksen: godkend"-link på hver opgave.
- I Voksen-menuen kan du godkende eller nulstille alle opgaver.

**Andre indstillinger i Voksen-menuen:**
- Hemmeligt kodeord (standard: `HALLOWEENGODTERI`, 16 bogstaver = ét pr. opgave).
- Voksen-kode.
- Oplæsning til/fra.
- *Nem tilstand* for de mindste.
- *Start forfra*.

## Pæn stemme (anbefalet)

Telefonernes egen oplæsning lyder robotagtig. I stedet kan du lave **lydfiler med en rigtig dansk AI-stemme** én gang. Så bruger alle telefoner dem automatisk.

**Med GitHub (nemmest, når siden ligger på GitHub):**

1. **Lav en gratis Microsoft Azure-konto, og opret en "Speech"-tjeneste.**
   - Azure-portalen hedder portal.azure.com. Søg efter *Speech* eller *Tale*.
   - Vælg prisniveau **Free F0** og fx region *West Europe*. F0 giver 500.000 tegn om måneden, og spillet bruger ca. 4.500.
   - Azure beder om et betalingskort ved oprettelsen, men F0 koster ikke noget.
2. **Kopiér nøglen og regionen.** Under *Keys and Endpoint* finder du *Key 1* og *Location/Region* (fx `westeurope`).
3. **Gem dem i GitHub-repoet.** Gå til *Settings → Secrets and variables → Actions → New repository secret*, og opret to hemmeligheder:
   - `AZURE_SPEECH_KEY` med nøglen
   - `AZURE_SPEECH_REGION` med regionen
4. **Lav lydfilerne.** Gå til fanen *Actions*, vælg **Lav stemmer**, og tryk **Run workflow**.
   Efter et par minutter ligger der en `lyd`-mappe i repoet, og siden bruger den pæne stemme.

Herefter laves nye lydfiler automatisk, når du retter tekster i `index.html`.

**Vælg stemme:** Standard er kvindestemmen *Christel*. Vil du have mandestemmen *Jeppe*, så opret en *variabel* (ikke hemmelighed) med navnet `STEMME` og værdien `da-DK-JeppeNeural`, og kør handlingen igen.

**Uden Azure:** ElevenLabs har en gratis konto uden betalingskort (10.000 tegn om måneden). Gem nøglen som hemmeligheden `ELEVENLABS_API_KEY` i stedet. Sæt evt. `STEMME` til et ElevenLabs *voice ID*.

**På din egen computer i stedet for GitHub:**

```bash
AZURE_SPEECH_KEY=din-nøgle AZURE_SPEECH_REGION=westeurope python3 stemmer/lav-stemmer.py
```

Læg derefter mappen `lyd` op sammen med `index.html`.

Er der ingen lydfiler, bruger spillet den pæneste danske stemme, telefonen selv har. Den kan vælges under Voksen-menu → *Stemme*.

## Prøv det på din computer

Kameraet virker kun på `https://` eller `localhost`. Fra denne mappe:

```bash
python3 -m http.server 8000
```

Åbn http://localhost:8000.
- Jagterne kan styres uden sensorer: træk med musen eller brug piletasterne for at dreje, og tryk på 👣-knappen eller mellemrumstasten for at gå et skridt.

## Læg det på nettet (via GitHub)

1. Opret et repository på GitHub, og læg hele mappen i det (også `stemmer` og `.github`).
2. Forbind repoet til en af disse (menunavnene kan variere lidt):
   - **Cloudflare Pages:** opret et Pages-projekt fra GitHub-repoet, lad *build command* være tom, og sæt *output directory* til `/`.
   - **Render:** vælg *New → Static Site*, lad *build command* være tom, og sæt *publish directory* til `.`.
3. Du får en `https://`-adresse. Den åbnes på telefonerne. Siden opdateres automatisk, når repoet ændres.

## Godt at vide

- **Kropsgenkendelse:** Googles MediaPipe. Den hentes fra internettet første gang spejlet åbnes (ca. 10 MB), så telefonerne skal have net.
- **Jagterne** bruger kun telefonens egne sensorer og virker uden net, når siden først er åbnet.
- **Gemt fremskridt:** ligger lige nu kun på den telefon, holdet bruger. Næste skridt er en lille server med MongoDB, så alt samles ét sted. Gemme-logikken ligger i `store` i `index.html`.
