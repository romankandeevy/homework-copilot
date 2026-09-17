/* Единицы величин, которые стоят за числом: «10 с», «27 г/моль», «2 м/с²».
   Списком, а не «любое слово»: «(a + b)/2 и …» не должно утащить «и» в
   знаменатель. Сокращения приставок (кДж, мА) собираются из приставки и
   основы. */
const unitBase = String.raw`(?:моль|мин|сут|Дж|Вт|Па|Ом|Гц|эВ|ч|с|г|т|м|л|Н|А|В|К|°C|°)`
const unitPrefix = String.raw`(?:к|м|мк|с|д|М|н)?`
const unitWord = String.raw`${unitPrefix}${unitBase}(?:[²³])?`
export const unitPattern = String.raw`${unitWord}(?:/${unitWord})*(?![\p{L}\d])`

/* Число с единицей не рвётся переносом.

   Аудит 16 сентября, Г7: химия на телефоне переносила «27 г/ | моль» - браузер
   видит место для переноса после косой черты и в пробеле между числом и
   единицей. Пробел становится неразрывным, а за чертой внутри единицы
   ставится соединитель слов (U+2060): он невидим и переноса не допускает.
   Копия решения (`notebookText.ts`) этого не касается - только отрисовка. */
const unitSpacing = new RegExp(String.raw`(\d)[ \u00a0](${unitPattern})`, 'gu')

export function unbreakableUnits(text: string) {
  return text.replace(unitSpacing, (_match, digit: string, unitText: string) => `${digit}\u00a0${unitText.replaceAll('/', '/\u2060')}`)
}
