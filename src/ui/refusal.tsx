/**
 * Why a control is dark, printed beside it.
 *
 * Every refusal kondo makes is a sentence the main process already wrote
 * (`capabilities.ts`), and a disabled control used to carry it as a `title`
 * only — which is to say a first-time user met a dead button and no reason at
 * all, because nobody hovers something that looks broken. The reason is the
 * more useful half of the refusal, so it goes on screen.
 */
export function Refusal({ reason }: { reason: string | null }) {
  if (reason === null) return null
  return <p className="refusal">{reason}</p>
}
