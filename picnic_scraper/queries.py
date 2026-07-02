from pathlib import Path


def load_hubs_main_content_query(repo_root: Path | None = None) -> str:
    root = repo_root or Path.cwd()
    captured = root / "captured_hubs_main_content.graphql"
    if captured.exists():
        return captured.read_text()
    return HUBS_MAIN_CONTENT_FALLBACK


def load_store_content_query(repo_root: Path | None = None) -> str:
    root = repo_root or Path.cwd()
    captured = root / "captured_store_content.graphql"
    if not captured.exists():
        raise FileNotFoundError(
            f"Missing {captured}. Capture a storeContent curl from a restaurant page: "
            "uv run python main.py capture capture_store_content.curl"
        )
    return captured.read_text()


HUBS_MAIN_CONTENT_FALLBACK = """
query HubsMainContent($hubsMainContentInput: HubsMainContentInput!) {
  hubsMainContent(input: $hubsMainContentInput) {
    hubsMetadata {
      hubsId
      timezone
      hubsFacilityMetadata {
        facilityId
      }
    }
    taggedLayout {
      storeTiles {
        key
        value {
          storeId
          facilityId
          brandName
          brandSlug
          locationSlug
          storeLogoUrl
          storeImageUrl
          tags
          storeStatus
          rating { score count }
          pricing { priceTag }
        }
      }
      menus {
        key
        value {
          menuInfos {
            id
            name
            fulfillmentModes
            categoryIds
          }
          categories {
            key
            value {
              id
              name
              description
              itemIds
            }
          }
          items {
            key
            value {
              id
              storeId
              name
              description
              priceData {
                price { currencyCode units nanos }
                displayPrice { currencyCode units nanos }
              }
              modifierGroupIds
              isSuspended
              itemStatus
              contents { isAlcoholic }
              photo { photoUrl }
              dietaryRestrictions { propertyId boolValue }
              allergens { propertyId boolValue }
            }
          }
          modifierGroups {
            key
            value {
              id
              name
              type
              selectionData {
                minimumNumberOfChoices
                maximumNumberOfChoices
              }
              itemIds
            }
          }
        }
      }
    }
  }
}
"""

SEARCH_ITEMS_AND_STORES = """
query SearchItemsAndStoresForHub($input: SearchItemsAndStoresForHubInput!) {
  searchItemsAndStoresForHub(input: $input) {
    ... on SearchItemsAndStoresForHubResponse {
      items {
        id
        storeId
        name
        description
        priceData {
          price { currencyCode units nanos }
          displayPrice { currencyCode units nanos }
        }
        modifierGroupIds
        isSuspended
        itemStatus
        contents { isAlcoholic }
        photo { photoUrl }
        dietaryRestrictions { propertyId boolValue }
        allergens { propertyId boolValue }
      }
      stores {
        storeId
        brandName
        brandSlug
        locationSlug
        storeLogoUrl
        storeStatus
      }
    }
  }
}
"""