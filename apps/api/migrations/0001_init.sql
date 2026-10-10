PRAGMA foreign_keys = ON;

-- Global competition settings
CREATE TABLE competition_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    is_open INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    max_storage_bytes INTEGER NOT NULL DEFAULT 8000000000,
    max_photo_size_bytes INTEGER NOT NULL DEFAULT 26214400,
    max_video_size_bytes INTEGER NOT NULL DEFAULT 524288000
);

-- Tracks total storage usage and reserved bytes
CREATE TABLE competition_usage (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    used_bytes INTEGER NOT NULL DEFAULT 0,
    reserved_bytes INTEGER NOT NULL DEFAULT 0
);

-- Core submission record
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,

    participant_name TEXT NOT NULL CHECK (length(trim(participant_name)) > 0),

    grade INTEGER NOT NULL CHECK (grade IN (11, 12)),

    section TEXT NOT NULL CHECK (
        (
            grade = 11
            AND section IN (
                'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
                'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18'
            )
        )
        OR
        (
            grade = 12
            AND section IN (
                'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9',
                'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18'
            )
        )
    ),

    roll_no TEXT NOT NULL CHECK (length(trim(roll_no)) > 0),

    category TEXT NOT NULL CHECK (category IN ('photo', 'video')),

    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'uploading', 'completed', 'rejected')
    ),

    receipt_token_hash TEXT NOT NULL CHECK (length(trim(receipt_token_hash)) > 0),

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Files attached to submissions
CREATE TABLE files (
    id TEXT PRIMARY KEY,

    submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

    category TEXT NOT NULL CHECK (category IN ('photo', 'video')),

    r2_key TEXT NOT NULL CHECK (length(trim(r2_key)) > 0),

    filename TEXT NOT NULL CHECK (length(trim(filename)) > 0),

    mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),

    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),

    upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        upload_status IN ('pending', 'completed', 'aborted')
    ),

    multipart_upload_id TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (
        (
            category = 'photo'
            AND size_bytes <= 26214400
            AND lower(mime_type) LIKE 'image/%'
        )
        OR
        (
            category = 'video'
            AND size_bytes <= 524288000
            AND lower(mime_type) LIKE 'video/%'
        )
    )
);

-- Temporary quota reservations
CREATE TABLE upload_reservations (
    id TEXT PRIMARY KEY,

    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,

    reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0),

    expires_at TEXT NOT NULL,

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX idx_submissions_category ON submissions(category);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_grade_section ON submissions(grade, section);

CREATE INDEX idx_files_submission ON files(submission_id);
CREATE INDEX idx_files_upload_status ON files(upload_status);

CREATE INDEX idx_reservations_expiry ON upload_reservations(expires_at);

-- Approved uniqueness rule:
-- One submission per Grade + Section + Roll No
CREATE UNIQUE INDEX idx_submissions_one_entry_per_student
ON submissions(grade, section, roll_no);

-- Receipt token hash should be unique
CREATE UNIQUE INDEX idx_submissions_receipt_token_hash
ON submissions(receipt_token_hash);

-- One active file per submission
CREATE UNIQUE INDEX idx_files_one_file_per_submission
ON files(submission_id)
WHERE upload_status != 'aborted';

-- One active reservation per file
CREATE UNIQUE INDEX idx_reservations_one_per_file
ON upload_reservations(file_id);

-- Seed required singleton rows
INSERT INTO competition_settings (
    id,
    is_open,
    start_date,
    end_date,
    max_storage_bytes,
    max_photo_size_bytes,
    max_video_size_bytes
)
VALUES (
    1,
    1,
    datetime('now'),
    datetime('now', '+30 days'),
    8000000000,
    26214400,
    524288000
)
ON CONFLICT(id) DO NOTHING;

INSERT INTO competition_usage (
    id,
    used_bytes,
    reserved_bytes
)
VALUES (
    1,
    0,
    0
)
ON CONFLICT(id) DO NOTHING;