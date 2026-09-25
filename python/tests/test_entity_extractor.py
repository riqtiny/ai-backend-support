import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from entity_extractor import extract_entities, process_ticket


class EntityExtractorTests(unittest.TestCase):
    def test_extracts_common_support_entities(self):
        result = extract_entities(
            "Invoice INV-2048 for Rp125.000 is missing. "
            "Contact alice@example.com or +62 812-3456-7890. "
            "See https://example.com/invoices/2048"
        )

        self.assertEqual(result["emails"], ["alice@example.com"])
        self.assertEqual(result["phones"], ["+62 812-3456-7890"])
        self.assertEqual(result["urls"], ["https://example.com/invoices/2048"])
        self.assertEqual(result["references"], ["INV-2048"])
        self.assertEqual(result["amounts"], ["Rp125.000"])

    def test_ignores_generic_reference_words(self):
        result = extract_entities("Invoice question and payment support")
        self.assertEqual(result["references"], [])

    def test_does_not_treat_iso_date_as_phone(self):
        result = extract_entities("Tanggal invoice 2026-09-25.")
        self.assertEqual(result["phones"], [])

    def test_process_ticket_uses_customer_email_field(self):
        result = process_ticket(
            {
                "id": "ticket-1",
                "customerEmail": "customer@example.com",
                "subject": "Cannot login",
                "message": "The login page returns an error.",
            }
        )

        self.assertEqual(result["ticket_id"], "ticket-1")
        self.assertEqual(result["subject"], "Cannot login")
        self.assertIn("customer@example.com", result["entities"]["emails"])
        self.assertNotIn("message", result)


if __name__ == "__main__":
    unittest.main()
