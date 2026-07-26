# White Glove — full pipeline diagram

One-page view: trigger → download → parse → HHA sync → validate/alerts.  
**Today:** manual Step Functions only (no auto schedule). **Hosting:** Lambda + Step Functions (serverless).

**Manual run:** [PipelineConsoleUrl](https://us-east-1.console.aws.amazon.com/states/home?region=us-east-1#/statemachines/view/arn:aws:states:us-east-1:065194293782:stateMachine:PipelineStateMachine88B77A5B-eJgbrZEUeDAf) — Start execution with `{ "runId": "manual-YYYY-MM-DD" }`.

```mermaid
flowchart TB
  subgraph TRIGGER["Trigger"]
    MANUAL["Manual: Step Functions → Start execution\n{ runId, dryRun? }"]
    SCHED["Optional future: EventBridge cron\n(enableDailySchedule=true)"]
  end

  subgraph AWS["AWS serverless"]
    SFN["Step Functions PipelineStateMachine\nmax 30 min"]
    S3[("S3 Reports Bucket\nruns/{runId}/raw + normalized + summary")]
    DDB[("DynamoDB Idempotency\nskip already-processed rows")]
    SNS["SNS Exception Topic → email"]
    PS_SEC["Secrets Manager\nProviderSoft creds"]
    HHA_SEC["Secrets Manager\nHHA SOAP creds"]
  end

  subgraph EXT["External"]
    PS["ProviderSoft"]
    HHA["HHAeXchange SOAP API"]
  end

  MANUAL --> SFN
  SCHED -.-> SFN

  SFN --> MERGE["MergeDefaults\nrunId + dryRun=false"]

  MERGE --> DL

  subgraph STEP1["① DownloadReports Lambda — 5–15 min"]
    DL --> STUB{PROVIDERSOFT_USE_STUBS?}
    STUB -->|true today| FAKE["Stub CSVs → S3"]
    STUB -->|false| CRED["Load PROVIDERSOFT_SECRET_ARN"]
    CRED --> PW["Playwright: reports 4526 4527 4528 4026\n3 login attempts"]
    PW -->|login fail| HTTP_ALL["HTTP fallback all reports"]
    PW -->|per report fail ×3| HTTP_ONE["HTTP fallback that report"]
    PW -->|ok| UP
    HTTP_ALL --> UP
    HTTP_ONE --> UP
    FAKE --> UP["Upload CSVs → S3 runs/{runId}/raw/"]
    UP --> DLOUT["DownloadResult"]
  end

  DLOUT -->|fail: SFN retry ×2 then| NF_DL["NotifyPipelineFailure → SNS"]
  NF_DL --> FAIL([Pipeline FAILED])

  DLOUT --> PARSE

  subgraph STEP2["② ParseNormalize Lambda"]
    PARSE["Load 3 CSVs from S3"] --> PV{S3 + parse OK?}
    PV -->|no| NF_P["NotifyPipelineFailure → SNS"] --> FAIL
    PV -->|yes| POPEN["parseOpenedCases + EI filter"]
    PV --> PCL["parseClosedCases"]
    PV --> PSE["parseVerifiedSessions"]
    POPEN --> NORM["Write normalized JSON → S3"]
    PCL --> NORM
    PSE --> NORM
    NORM --> PAROUT["ParseResult"]
  end

  PAROUT --> PAR

  subgraph STEP3["③ SyncToHha — Parallel (3 Lambdas)"]
    PAR --> OPEN
    PAR --> CLOSED
    PAR --> SESS

    subgraph OPENED["OpenedBranch — Gluck open"]
      OPEN --> O_EI["Skip Early Intervention\nexception skipped_by_rule"]
      O_EI --> O_ROW{each row}
      O_ROW --> O_V1{caseId firstName lastName?}
      O_V1 -->|no| O_F1["FAIL parse_error"]
      O_V1 -->|yes| O_IDEM{idempotent?}
      O_IDEM -->|yes| O_SKIP[skip]
      O_IDEM -->|no| O_SC{Service Type mapped?}
      O_SC -->|missing| O_A1["alert missing_service_code"]
      O_SC -->|unknown| O_A2["alert unknown_service_code"]
      O_SC -->|ok| O_HHA["HHA: upsertPatient → upsertContract → upsertAuthorization"]
      O_HHA -->|error| O_F2["FAIL hha_api_error"]
      O_HHA -->|ok| O_OK[success + mark DDB]
    end

    subgraph CLOSED["ClosedBranch — Gluck closure"]
      CLOSED --> C_ROW{each row}
      C_ROW --> C_V1{caseId?}
      C_V1 -->|no| C_F1["FAIL parse_error"]
      C_V1 -->|yes| C_EI{Early Intervention?}
      C_EI -->|yes| C_SKIP["skip skipped_by_rule"]
      C_EI -->|no| C_IDEM{idempotent?}
      C_IDEM -->|yes| C_SKIP2[skip]
      C_IDEM -->|no| C_HHA["HHA: updateClosedCase\nUpdatePatientContract discharge"]
      C_HHA -->|error| C_F2["FAIL hha_api_error"]
      C_HHA -->|ok| C_OK[success + mark DDB]
    end

    subgraph SESSIONS["SessionsBranch — API Report"]
      SESS --> S_ROW{each row}
      S_ROW --> S_V0{sessionId?}
      S_V0 -->|no| S_F0["FAIL parse_error"]
      S_V0 -->|yes| S_IDEM{idempotent?}
      S_IDEM -->|yes| S_SKIP0[skip]
      S_IDEM -->|no| S_TRIAGE["triageVerifiedSession"]

      S_TRIAGE --> S_T1{Early Intervention?}
      S_T1 -->|yes| S_SKIP1["skip skipped_by_rule"]
      S_T1 -->|no| S_T2{Program in EVV list?}
      S_T2 -->|yes| S_MODE_V["verify_clocking"]
      S_T2 -->|no| S_T3{Program in no-EVV list?}
      S_T3 -->|yes| S_MODE_A["auto_approve"]
      S_T3 -->|no| S_T4{status cancelled rejected do_not_bill?}
      S_T4 -->|yes| S_SKIP2[skip]
      S_T4 -->|no| S_T5{service code mapped?}
      S_T5 -->|missing unknown| S_SKIP3["skip + alert"]
      S_T5 -->|ok| S_MODE_M[use mapping default]

      S_MODE_V --> S_HHA
      S_MODE_A --> S_HHA
      S_MODE_M --> S_HHA

      S_HHA["upsertPatient → locateOrScheduleVisit"] --> S_EVV{verify_clocking?}
      S_EVV -->|yes| S_CLK["getClockingDetails\nPS times vs HHA EVV"]
      S_CLK -->|mismatch| S_F1["FAIL clocking_mismatch"]
      S_CLK -->|match| S_APP
      S_EVV -->|no| S_APP["approveVisit ConfirmVisits"]
      S_APP -->|error| S_F2["FAIL hha_api_error"]
      S_APP -->|ok| S_OK[success + mark DDB]
    end
  end

  OPEN -->|branch crash| NF_S["NotifyPipelineFailure → SNS"] --> FAIL
  CLOSED --> NF_S
  SESS --> NF_S

  OPEN --> VAL
  CLOSED --> VAL
  SESS --> VAL

  subgraph STEP4["④ ValidateAndNotify Lambda"]
    VAL["Merge exceptions from all 3 branches\ncount hardFailures"] --> VS3["Write validate-summary + exceptions → S3"]
    VS3 --> VALCHK{hardFailures or exceptions?}
    VALCHK -->|yes| VALSNS["SNS email: summary by error code\nup to 15 samples per type"]
    VALCHK -->|no| VALOK[ok=true]
    VALSNS --> DONE
    VALOK --> DONE
  end

  VAL -->|Lambda crash| NF_V["NotifyPipelineFailure → SNS"] --> FAIL

  DONE([Run complete])

  PS_SEC -.-> CRED
  HHA_SEC -.-> O_HHA
  HHA_SEC -.-> C_HHA
  HHA_SEC -.-> S_HHA
  PS -.-> PW
  PS -.-> HTTP_ALL
  HHA -.-> O_HHA
  HHA -.-> C_HHA
  HHA -.-> S_HHA
  S3 -.-> PARSE
  S3 -.-> VS3
  DDB -.-> O_IDEM
  DDB -.-> C_IDEM
  DDB -.-> S_IDEM
  SNS -.-> VALSNS
  SNS -.-> NF_DL
  SNS -.-> NF_P
  SNS -.-> NF_S
  SNS -.-> NF_V
```

## Legend

| Symbol | Meaning |
|--------|---------|
| **FAIL** | Row hard failure — counted in `failed`, included in SNS summary |
| **alert / skip + alert** | Exception logged; may still continue other rows |
| **skip skipped_by_rule** | Business rule (usually EI) — not sent to HHA |
| **NotifyPipelineFailure** | Whole step crashed or timed out — SNS with step name + error |
| **idempotent?** | DynamoDB — same row in same runId already processed → skip |

## Planned schedule (client — not active)

| Job | When |
|-----|------|
| Open + close | Daily or 2× daily (TBD, ET) |
| Verified sessions | Tuesday 12:00 ET |
| Code preview (not built) | Tuesday 11:00 ET — alert new unknown codes only |
