#!/usr/bin/env python3
"""
Laver lydfiler med en pæn dansk AI-stemme til Heksens Trylledrik.

Scriptet læser alle opgaver og replikker direkte fra index.html og gemmer en lydfil
pr. replik i mappen lyd/ samt lyd/stemmer.json, som spillet læser. Når filerne ligger
på siden, bruger alle telefoner dem i stedet for telefonens egen (robot)stemme.

Kun filer, hvor teksten er ændret, bliver lavet igen.

Brug (kræver kun Python 3 – ingen ekstra pakker):

  Microsoft Azure (anbefalet – ægte danske stemmer, gratis op til 500.000 tegn/md.):
    AZURE_SPEECH_KEY=din-nøgle AZURE_SPEECH_REGION=westeurope python3 stemmer/lav-stemmer.py
    Vælg stemme med --stemme da-DK-ChristelNeural (kvinde, standard) eller da-DK-JeppeNeural (mand).

  ElevenLabs (gratis konto, 10.000 tegn/md.):
    ELEVENLABS_API_KEY=din-nøgle python3 stemmer/lav-stemmer.py --tjeneste elevenlabs --stemme <voice_id>

  --auto vælger selv Azure eller ElevenLabs ud fra hvilken nøgle der findes (bruges af GitHub-handlingen).
"""
import argparse, hashlib, html, json, math, os, re, struct, sys, time, urllib.error, urllib.request, wave

ROD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LYD = os.path.join(ROD, 'lyd')
MANIFEST = os.path.join(LYD, 'stemmer.json')
ELEVEN_STANDARD = '21m00Tcm4TlvDq8ikWAM'   # ElevenLabs' standardstemme "Rachel" (taler dansk med multilingual-modellen)


def hent_blok(kilde, navn):
    m = re.search(r'/\*%s-START\*/(.*?)/\*%s-END\*/' % (navn, navn), kilde, re.S)
    if not m:
        sys.exit(f'Kunne ikke finde {navn} i index.html')
    return json.loads(m.group(1))


def replikker():
    with open(os.path.join(ROD, 'index.html'), encoding='utf-8') as f:
        kilde = f.read()
    ud = {}
    for t in hent_blok(kilde, 'TASKS'):
        ud['task-' + t['id']] = f"{t['name']}. {t['text']}"
    ud.update(hent_blok(kilde, 'PHRASES'))
    return ud


def ren_tekst(t):
    return re.sub(r'\s+', ' ', t.replace('–', ',').replace('—', ',')).strip()


def http(req, forsoeg=4):
    for i in range(forsoeg):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and i < forsoeg - 1:
                time.sleep(2 * (i + 1)); continue
            raise SystemExit(f'Fejl fra stemmetjenesten ({e.code}): {e.read()[:300].decode("utf-8", "replace")}')
        except urllib.error.URLError as e:
            if i < forsoeg - 1:
                time.sleep(2 * (i + 1)); continue
            raise SystemExit(f'Kunne ikke nå stemmetjenesten: {e.reason}')


def azure(tekst, stemme, tempo):
    noegle, region = os.environ.get('AZURE_SPEECH_KEY'), os.environ.get('AZURE_SPEECH_REGION')
    if not noegle or not region:
        sys.exit('Sæt AZURE_SPEECH_KEY og AZURE_SPEECH_REGION (fx westeurope).')
    ssml = (f"<speak version='1.0' xml:lang='da-DK'><voice name='{stemme}'>"
            f"<prosody rate='{tempo}'>{html.escape(tekst)}</prosody></voice></speak>")
    req = urllib.request.Request(
        f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1', data=ssml.encode('utf-8'),
        headers={'Ocp-Apim-Subscription-Key': noegle, 'Content-Type': 'application/ssml+xml',
                 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'heksens-trylledrik'})
    return http(req), 'mp3'


def elevenlabs(tekst, stemme, tempo):
    noegle = os.environ.get('ELEVENLABS_API_KEY')
    if not noegle:
        sys.exit('Sæt ELEVENLABS_API_KEY.')
    body = json.dumps({'text': tekst, 'model_id': 'eleven_multilingual_v2',
                       'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75}}).encode('utf-8')
    req = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{stemme}?output_format=mp3_44100_128', data=body,
        headers={'xi-api-key': noegle, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
    return http(req), 'mp3'


def test(tekst, stemme, tempo):
    """Laver korte bip i stedet for tale – kun til at afprøve opsætningen uden en stemmetjeneste."""
    import io
    rate, sek = 16000, min(2.5, 0.25 + len(tekst) * 0.01)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(int(rate * sek))))
    return buf.getvalue(), 'wav'


TJENESTER = {'azure': azure, 'elevenlabs': elevenlabs, 'test': test}


def main():
    ap = argparse.ArgumentParser(description='Lav lydfiler til Heksens Trylledrik.')
    ap.add_argument('--tjeneste', choices=list(TJENESTER), default='azure')
    ap.add_argument('--auto', action='store_true', help='vælg tjeneste ud fra de nøgler, der er sat')
    ap.add_argument('--stemme', default='', help='Azure: fx da-DK-ChristelNeural · ElevenLabs: voice_id')
    ap.add_argument('--tempo', default='-5%', help='Azure: talehastighed, fx -10%% (langsommere) eller 0%%')
    ap.add_argument('--alle', action='store_true', help='lav alle filer igen, også uændrede')
    a = ap.parse_args()

    tjeneste = a.tjeneste
    if a.auto:
        if os.environ.get('AZURE_SPEECH_KEY'): tjeneste = 'azure'
        elif os.environ.get('ELEVENLABS_API_KEY'): tjeneste = 'elevenlabs'
        else:
            print('Ingen nøgle til en stemmetjeneste er sat – springer over. Spillet bruger telefonens egen stemme.')
            return
    stemme = a.stemme or {'azure': 'da-DK-ChristelNeural', 'elevenlabs': ELEVEN_STANDARD, 'test': 'test'}[tjeneste]
    if tjeneste == 'elevenlabs' and 'Neural' in stemme: stemme = ELEVEN_STANDARD

    os.makedirs(LYD, exist_ok=True)
    gammel = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f: gammel = json.load(f)
    filer, hashes = {}, {}
    linjer = replikker()
    nye = 0
    for i, (noegle, tekst) in enumerate(linjer.items(), 1):
        tekst = ren_tekst(tekst)
        h = hashlib.sha1(f'{tjeneste}|{stemme}|{a.tempo}|{tekst}'.encode('utf-8')).hexdigest()[:12]
        tidligere = gammel.get('files', {}).get(noegle)
        if not a.alle and tidligere and gammel.get('hash', {}).get(noegle) == h and os.path.exists(os.path.join(LYD, tidligere)):
            filer[noegle], hashes[noegle] = tidligere, h
            continue
        data, endelse = TJENESTER[tjeneste](tekst, stemme, a.tempo)
        navn = f'{noegle}.{endelse}'
        with open(os.path.join(LYD, navn), 'wb') as f: f.write(data)
        filer[noegle], hashes[noegle] = navn, h
        nye += 1
        print(f'[{i}/{len(linjer)}] {noegle}')
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({'voice': stemme if tjeneste != 'elevenlabs' else f'ElevenLabs {stemme}', 'provider': tjeneste,
                   'files': filer, 'hash': hashes}, f, ensure_ascii=False, indent=1)
    print(f'Færdig: {nye} nye lydfiler, {len(filer)} i alt i {LYD}')


if __name__ == '__main__':
    main()
