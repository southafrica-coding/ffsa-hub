"use client";

import Link from "next/link";
import { FormBuilder, type FormBuilderMeta } from "@/components/forms/form-builder";
import type { FormSchema } from "@/lib/forms/schema";
import { isMissioPastor } from "../access";
import { useMissioViewer } from "../viewer";
import { PublicFeedbackLink } from "./public-link";
import content from "../content.module.css";
import styles from "./form-editor.module.css";

export type MissioWeeklyFormView = FormBuilderMeta & { schema: FormSchema };

/**
 * The weekly feedback form's questions, inside Missio (pastors only). The
 * page has already checked the org role on the server and only sends the
 * form to a pastor; this checks the shell's viewer too, as Finance does.
 */
export function MissioFeedbackFormEditor({ pastor, form }: { pastor: boolean; form: MissioWeeklyFormView | null }) {
  const me = useMissioViewer();
  const viewerPastor = me ? isMissioPastor(me) : false;

  if (!pastor || !viewerPastor) {
    return (
      <div className={`${content.page} ${styles.page}`} data-testid="missio-feedback-form-denied">
        <section className={styles.empty}>
          <h1 className={styles.emptyTitle}>Pastors only</h1>
          <p>The weekly feedback questions are edited by the church’s pastors.</p>
        </section>
      </div>
    );
  }

  if (!form) {
    return (
      <div className={`${content.page} ${styles.page}`} data-testid="missio-feedback-form-closed">
        <Link href="/missio/house-churches/feedback" className={styles.back}>
          ← Weekly feedback
        </Link>
        <section className={styles.empty}>
          <h1 className={styles.emptyTitle}>The feedback form isn’t open yet</h1>
          <p>
            The weekly feedback form hasn’t been set up, or it’s switched off. Ask a Hub admin to open it; its questions
            can be edited here once it is.
          </p>
        </section>
      </div>
    );
  }

  const { schema, ...meta } = form;
  return (
    <div className={styles.editor} data-testid="missio-feedback-form">
      <p className={styles.note}>
        These are the questions house church leaders answer each week. Leaders open the public link below, choose their
        house church, and fill it in; signed-in leaders can also fill it in from their house page. See what came in on{" "}
        <Link href="/missio/house-churches/feedback">Weekly feedback</Link>. Changes reach every house the next time
        the form is opened.
      </p>
      <div className={styles.publicLink}>
        <PublicFeedbackLink />
      </div>
      <FormBuilder
        form={meta}
        initialSchema={schema}
        backHref="/missio/house-churches/feedback"
        backLabel="Weekly feedback"
        responsesHref="/missio/house-churches/feedback"
        contextLabel="Missio · weekly feedback form"
        questionsOnly
      />
    </div>
  );
}
