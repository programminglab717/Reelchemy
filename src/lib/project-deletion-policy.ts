export class ProjectDeletionConflict extends Error {
  constructor(
    message = "Move the project to Trash before permanently deleting it.",
  ) {
    super(message);
    this.name = "ProjectDeletionConflict";
  }
}
