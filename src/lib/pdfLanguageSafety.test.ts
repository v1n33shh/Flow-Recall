import { describe, expect, it } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractPdfParagraphsStreaming } from "@/lib/pdfTextExtract";

function docOf(paragraphs: string[]): PDFDocumentProxy {
  // One paragraph per page keeps the geometry trivial; the decoder's batch-level
  // shift vote still sees them all together, which is the interaction under test.
  return {
    numPages: paragraphs.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({
        items: [{ str: paragraphs[n - 1], transform: [12, 0, 0, 12, 40, 700], height: 12 }],
      }),
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy;
}

const LANGUAGES: Record<string, string[]> = {
  German: [
    "Das Gedächtnis ist kein Lagerhaus für Daten, sondern eine Praxis, die Anstrengung und ständige Wiederholung verlangt.",
    "Wer eine Sprache lernen will, muss sie täglich benutzen. Ohne Übung verschwindet das Wissen wieder.",
  ],
  Spanish: [
    "La memoria no es un almacén de datos, sino una práctica que exige esfuerzo y repetición constante en el tiempo.",
    "Quien quiere aprender un idioma tiene que usarlo todos los días; sin práctica el conocimiento desaparece.",
  ],
  French: [
    "La mémoire n'est pas un entrepôt de données, mais une pratique qui exige de l'effort et une répétition constante.",
    "Celui qui veut apprendre une langue doit la pratiquer chaque jour, sinon les connaissances disparaissent.",
  ],
  Italian: [
    "La memoria non è un magazzino di dati, ma una pratica che richiede sforzo e ripetizione costante nel tempo.",
    "Chi vuole imparare una lingua deve usarla ogni giorno, altrimenti la conoscenza svanisce di nuovo.",
  ],
  Portuguese: [
    "A memória não é um armazém de dados, mas uma prática que exige esforço e repetição constante ao longo do tempo.",
    "Quem quer aprender uma língua precisa de a usar todos os dias; sem prática o conhecimento desaparece.",
  ],
  Dutch: [
    "Het geheugen is geen opslagplaats van gegevens, maar een praktijk die inspanning en constante herhaling vereist.",
    "Wie een taal wil leren moet die elke dag gebruiken, anders verdwijnt de kennis weer helemaal.",
  ],
  Polish: [
    "Pamięć nie jest magazynem danych, lecz praktyką wymagającą wysiłku i stałego powtarzania w czasie.",
    "Kto chce nauczyć się języka, musi go używać codziennie, bo inaczej wiedza znowu zniknie.",
  ],
  Turkish: [
    "Bellek bir veri deposu değildir; sürekli tekrar ve çaba gerektiren bir pratiktir, hem de her gün.",
    "Bir dili öğrenmek isteyen onu her gün kullanmalıdır, yoksa bilgi yeniden kaybolup gider.",
  ],
};

/** The shape a Type3-encoded PDF hands us: printable characters moved up by a
 * fixed amount, spaces left alone. */
function cipher(text: string, by: number): string {
  return [...text].map((ch) => (ch === " " ? " " : String.fromCharCode(ch.charCodeAt(0) + by))).join("");
}

describe("ciphered text is still rescued", () => {
  // Eight paragraphs, as a real first batch would carry - enough for the
  // document-level shift vote to establish itself the way it does in a book.
  const plain = [
    "the master said that trust is the only door, and the disciple asked how one finds it.",
    "in the beginning there was silence, and out of that silence came the first of all words.",
    "he laughed and said, the mind is a beautiful servant, but it is a very dangerous master.",
    "the seeker travelled for many years before he understood that the road itself was home.",
    "there is nothing to attain, and that is the hardest of all the things one has to learn.",
    "when the teacher was asked about death, he spoke instead about the ordinary morning sun.",
    "a man who knows that he knows nothing has already taken the first step of the long path.",
    "the river does not argue with the stone; it simply goes around it and carries on going.",
  ];

  it("never turns a paragraph into a third thing, at any shift", async () => {
    let fullyRescued = 0;
    for (let shift = 1; shift <= 40; shift++) {
      const ciphered = plain.map((p) => cipher(p, shift));
      const result = await extractPdfParagraphsStreaming(docOf(ciphered), () => {});
      result.paragraphs.forEach((out, i) => {
        // Either the shift was undone or it was left alone. What must never
        // happen is a paragraph coming out as some other string entirely.
        expect([plain[i], ciphered[i]], `shift ${shift}, paragraph ${i}`).toContain(out);
      });
      if (JSON.stringify(result.paragraphs) === JSON.stringify(plain)) fullyRescued++;
    }
    // The guard must not have quietly switched the rescue off: this decoder is
    // the only reason the user's Type3-encoded books are readable at all. Every
    // shift in the sweep is fully recovered now, so anything less is a
    // regression, not a tolerance.
    expect(fullyRescued).toBe(40);
  });

  it("fully recovers a book-shaped document at the shifts seen in the wild", async () => {
    for (const shift of [2, 3, 5, 16]) {
      const result = await extractPdfParagraphsStreaming(docOf(plain.map((p) => cipher(p, shift))), () => {});
      expect(result.paragraphs, `shift ${shift}`).toEqual(plain);
    }
  });
});

describe("legible text is never re-encoded", () => {
  for (const [language, paragraphs] of Object.entries(LANGUAGES)) {
    it(`leaves ${language} exactly as it found it`, async () => {
      const result = await extractPdfParagraphsStreaming(docOf(paragraphs), () => {});
      expect(result.paragraphs).toEqual(paragraphs);
    });
  }

  it("leaves a whole mixed-language document alone", async () => {
    const all = Object.values(LANGUAGES).flat();
    const result = await extractPdfParagraphsStreaming(docOf(all), () => {});
    expect(result.paragraphs).toEqual(all);
  });

  it("leaves English edge cases alone", async () => {
    const odd = [
      "CHAPTER SEVENTEEN: THE UNIVERSITY OF INNER ALCHEMY, AND WHAT IT TEACHES US",
      "1. 1,240 kg 2. 3,480 kg 3. 12,900 kg 4. 44,010 kg 5. 88,120 kg 6. 96,400 kg",
      "e = mc^2; F = ma; PV = nRT; sin^2(x) + cos^2(x) = 1; a^2 + b^2 = c^2",
    ];
    const result = await extractPdfParagraphsStreaming(docOf(odd), () => {});
    expect(result.paragraphs).toEqual(odd);
  });
});
