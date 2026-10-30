export class ExportRequestConflict extends Error {
  constructor() {
    super(
      "This export request was already used for a different saved version. Start a new export request.",
    );
  }
}
