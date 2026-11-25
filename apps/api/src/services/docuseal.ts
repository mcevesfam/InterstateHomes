export interface DocuSealSubmissionRequest {
  poNumber: string;
  documentTitle: string;
  subSignerName: string;
  subSignerEmail: string;
  approverName: string;
  approverEmail: string;
  masterAgreementRef: string;
  totalCents: number;
}

export interface DocuSealSubmissionResponse {
  submissionId: string;
  status: 'pending_sub_signature';
  signingUrl: string;
  mode: 'docuseal_live' | 'docuseal_stub';
}

export async function createPoDocuSealSubmission(
  req: DocuSealSubmissionRequest
): Promise<DocuSealSubmissionResponse> {
  const docuSealUrl = process.env.DOCUSEAL_URL;
  const apiKey = process.env.DOCUSEAL_API_KEY;

  if (docuSealUrl && apiKey) {
    const res = await fetch(`${docuSealUrl.replace(/\/$/, '')}/api/submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': apiKey,
      },
      body: JSON.stringify({
        send_email: false, // Controlled by Interstate Homes explicit send rule (Rule 13)
        submitters: [
          {
            role: 'Subcontractor',
            name: req.subSignerName,
            email: req.subSignerEmail,
          },
          {
            role: 'Interstate Approver',
            name: req.approverName,
            email: req.approverEmail,
          },
        ],
        metadata: {
          po_number: req.poNumber,
          master_agreement_ref: req.masterAgreementRef,
          total_cents: req.totalCents,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`DocuSeal submission failed (HTTP ${res.status}).`);
    }

    const data = (await res.json()) as { id?: string | number; slug?: string };
    const submissionId = String(data.id ?? `ds-${Date.now()}`);
    return {
      submissionId,
      status: 'pending_sub_signature',
      signingUrl: `${docuSealUrl.replace(/\/$/, '')}/s/${data.slug ?? submissionId}`,
      mode: 'docuseal_live',
    };
  }

  const submissionId = `ds-local-${req.poNumber.toLowerCase()}`;
  return {
    submissionId,
    status: 'pending_sub_signature',
    signingUrl: `/purchase-orders?sign=${encodeURIComponent(submissionId)}`,
    mode: 'docuseal_stub',
  };
}
