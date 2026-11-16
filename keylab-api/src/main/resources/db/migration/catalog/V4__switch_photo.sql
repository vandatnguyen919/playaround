-- US-38: a switch photo, uploaded through ADM-04 and named on ADM-02 as
-- photoUploadId. The sound module owns the file; catalog keeps its URL.
ALTER TABLE switches ADD COLUMN photo_url TEXT;
