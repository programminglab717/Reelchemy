import { layerSchema, type Timeline } from "./schema";

export function duplicateLayer(
  timeline: Timeline,
  sceneIndex: number,
  layerId: string,
  newId: string = crypto.randomUUID(),
): { timeline: Timeline; layerId: string } {
  const scene = timeline.scenes[sceneIndex],
    source = scene?.layers.find((layer) => layer.id === layerId);
  if (!source) throw new Error("Select a layer to duplicate.");
  if (source.locked) throw new Error("Unlock the layer before duplicating it.");
  if (scene.layers.length >= 20)
    throw new Error("This scene already has 20 layers.");
  if (
    !layerSchema.shape.id.safeParse(newId).success ||
    scene.layers.some((layer) => layer.id === newId)
  )
    throw new Error("Choose a new layer identifier.");
  const copied = { ...structuredClone(source), id: newId },
    index = scene.layers.indexOf(source);
  return {
    layerId: copied.id,
    timeline: {
      ...timeline,
      scenes: timeline.scenes.map((entry, i) =>
        i === sceneIndex
          ? {
              ...entry,
              layers: [
                ...entry.layers.slice(0, index + 1),
                copied,
                ...entry.layers.slice(index + 1),
              ],
            }
          : entry,
      ),
    },
  };
}
