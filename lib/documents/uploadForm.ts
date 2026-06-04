export function getUploadFiles(form: FormData): File[] {
  return form
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);
}
