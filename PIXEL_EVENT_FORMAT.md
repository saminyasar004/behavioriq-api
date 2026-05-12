# Pixel Event Format

## Sample Hardcoded Event Batch

This is the JSON structure the pixel SDK sends to `/api/events/batch` endpoint.

```json
{
	"events": [
		{
			"event_type": "product_view",
			"user_id": "user_550e8400-e29b-41d4-a716-446655440000",
			"session_id": "session_550e8400-e29b-41d4-a716-446655440001",
			"payload": {
				"product_id": "prod_001",
				"time_spent_ms": 3500,
				"scroll_depth": 0.65,
				"price_seen": 2500
			},
			"timestamp": "2026-05-13T10:30:45.123Z"
		},
		{
			"event_type": "product_click",
			"user_id": "user_550e8400-e29b-41d4-a716-446655440000",
			"session_id": "session_550e8400-e29b-41d4-a716-446655440001",
			"payload": {
				"product_id": "prod_001"
			},
			"timestamp": "2026-05-13T10:31:15.456Z"
		},
		{
			"event_type": "search",
			"user_id": "user_550e8400-e29b-41d4-a716-446655440000",
			"session_id": "session_550e8400-e29b-41d4-a716-446655440001",
			"payload": {
				"query": "running shoes"
			},
			"timestamp": "2026-05-13T10:32:00.789Z"
		},
		{
			"event_type": "cart_add",
			"user_id": "user_550e8400-e29b-41d4-a716-446655440000",
			"session_id": "session_550e8400-e29b-41d4-a716-446655440001",
			"payload": {
				"product_id": "prod_001"
			},
			"timestamp": "2026-05-13T10:33:00.000Z"
		},
		{
			"event_type": "page_exit",
			"user_id": "user_550e8400-e29b-41d4-a716-446655440000",
			"session_id": "session_550e8400-e29b-41d4-a716-446655440001",
			"payload": {
				"time_spent_ms": 180000
			},
			"timestamp": "2026-05-13T10:36:00.000Z"
		}
	]
}
```

## Event Types

- `product_view` — User viewed a product
- `product_click` — User clicked on a product
- `search` — User performed a search
- `cart_add` — User added item to cart
- `cart_remove` — User removed item from cart
- `checkout` — User initiated checkout
- `page_exit` — User left the page

## Expected Response

```json
{
	"success": true,
	"eventsProcessed": 5,
	"message": "Batch ingested successfully"
}
```
