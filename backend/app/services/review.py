from datetime import datetime
from fastapi import HTTPException
from http import HTTPStatus
from app.repositories.review import ReviewRepository
from app.repositories.watchlist import WatchlistRepository
from app.services.igdb_client import IGDBClient
from app.models.user import Avaliacao, Jogo
from app.schemas.review import ReviewCreate, ReviewPublic

def resolve_country_and_market(country_id: int | None):
    if not country_id: return None, "Global"
    iso_map = {
        840: ("Estados Unidos", "EUA"), 392: ("Japão", "Asia"), 156: ("China", "Asia"),
        410: ("Coreia do Sul", "Asia"), 826: ("Reino Unido", "Europa"), 250: ("França", "Europa"),
        276: ("Alemanha", "Europa"), 124: ("Canadá", "America do Norte"), 752: ("Suécia", "Europa"),
        616: ("Polônia", "Europa"), 76:  ("Brasil", "América do Sul")
    }
    if country_id in iso_map: return iso_map[country_id][0], iso_map[country_id][1]
    return "Desconhecido", "Global"

class ReviewService:
    def __init__(self, review_repo: ReviewRepository, watchlist_repo: WatchlistRepository, igdb_client: IGDBClient = None):
        self.review_repo = review_repo
        self.watchlist_repo = watchlist_repo
        self.igdb_client = igdb_client

    async def _ensure_game_exists_locally(self, igdb_id: int) -> int:
        """
        Verifica se o jogo existe no banco local pelo IGDB ID.
        Se existir, retorna o id_jogo (interno).
        Se não, baixa do IGDB, salva no banco e retorna o novo id_jogo.
        """

        internal_id = await self.watchlist_repo.get_id_jogo_by_igdb(igdb_id)
        if internal_id:
            return internal_id

        if not self.igdb_client:
            raise HTTPException(status_code=500, detail="IGDB Client não configurado no ReviewService")

        igdb_game = await self.igdb_client.get_game_by_id(igdb_id)
        if not igdb_game:
            raise HTTPException(status_code=404, detail="Jogo não encontrado no IGDB para avaliação")

        game_title = igdb_game["name"]
        
        existing_game = await self.watchlist_repo.get_game_by_title(game_title)
        if existing_game:
            return existing_game.id_jogo

        dev_id = None
        pub_id = None
        
        companies = igdb_game.get("involved_companies", [])
        for comp_data in companies:
            c_data = comp_data.get("company", {})
            c_name = c_data.get("name")
            if not c_name: continue
            
            c_country_id = c_data.get("country")
            c_start_ts = c_data.get("start_date")
            dt_fundacao = None
            if c_start_ts:
                try: dt_fundacao = datetime.fromtimestamp(c_start_ts).date()
                except: dt_fundacao = None
            
            pais_nome, mercado_nome = resolve_country_and_market(c_country_id)

            if comp_data.get("developer") and not dev_id:
                existing_id = await self.watchlist_repo.get_company_by_name(c_name)
                dev_id = existing_id if existing_id else await self.watchlist_repo.create_company_raw(c_name, 'desenvolvedora', dt_fundacao, pais_nome, mercado_nome)
            
            elif comp_data.get("publisher") and not pub_id:
                existing_id = await self.watchlist_repo.get_company_by_name(c_name)
                pub_id = existing_id if existing_id else await self.watchlist_repo.create_company_raw(c_name, 'publicadora', dt_fundacao, pais_nome, mercado_nome)

        nota = int(igdb_game.get("aggregated_rating", 0)) if igdb_game.get("aggregated_rating") else None
        cover_url = igdb_game.get("cover", {}).get("url", "")
        if cover_url: cover_url = "https:" + cover_url.replace("t_thumb", "t_cover_big")


        novo_jogo = Jogo(
            titulo=game_title,
            descricao=igdb_game.get("summary"),
            nota_metacritic=nota,
            id_desenvolvedor=dev_id,
            id_publicadora=pub_id,
            capa_url=cover_url,
            id_igdb=igdb_game["id"]
        )
        
        new_game_id = await self.watchlist_repo.create_game_raw(novo_jogo)

        for g_data in igdb_game.get("genres", []):
            g_nome = g_data["name"]
            genero = await self.watchlist_repo.get_genre_by_name(g_nome)
            gid = genero.id_genero if genero else await self.watchlist_repo.create_genre_raw(g_nome)
            await self.watchlist_repo.link_game_genre(new_game_id, gid)

        release_ts = igdb_game.get("first_release_date")
        release_date = datetime.fromtimestamp(release_ts).date() if release_ts else None
        
        for p_data in igdb_game.get("platforms", []):
            p_nome = p_data["name"]
            plat = await self.watchlist_repo.get_platform_by_name(p_nome)
            pid = plat.id_plataforma if plat else await self.watchlist_repo.create_platform_raw(p_nome)
            await self.watchlist_repo.link_game_platform(new_game_id, pid, release_date)

        for dlc_data in igdb_game.get("dlcs", []):
            if dlc_data.get("name"):
                await self.watchlist_repo.create_dlc_raw(new_game_id, dlc_data.get("name"), dlc_data.get("summary"))

        return new_game_id

    async def create_review(self, user_id: int, game_id: int, schema: ReviewCreate) -> ReviewPublic:
        """
        Adiciona review. game_id aqui é o ID DO IGDB (vindo do front).
        Convertemos para ID interno antes de salvar.
        """
        real_game_id = await self._ensure_game_exists_locally(game_id)


        review_existente = await self.review_repo.get_by_user_and_game(user_id, real_game_id)

        if review_existente:
            review_existente.nota = schema.nota
            review_existente.comentario = schema.comentario
            saved_review = await self.review_repo.update_review(review_existente)
        else:
            nova_avaliacao = Avaliacao(
                nota=schema.nota,
                comentario=schema.comentario,
                id_jogo=real_game_id, 
                id_user=user_id
            )
            saved_review = await self.review_repo.create_review(nova_avaliacao)
        
        return ReviewPublic(
            id_avaliacao=saved_review.id_avaliacao,
            nota=saved_review.nota,
            comentario=saved_review.comentario,
            id_jogo=saved_review.id_jogo,
            id_user=saved_review.id_user
        )

    async def get_game_reviews(self, game_id: int) -> dict:
        """
        Busca reviews. game_id pode ser IGDB. Tentamos converter.
        """

        internal_id = await self.watchlist_repo.get_id_jogo_by_igdb(game_id)
        
        id_to_search = internal_id if internal_id else game_id

        reviews_data = await self.review_repo.get_reviews_by_game(id_to_search)
        
        media = 0.0
        if reviews_data:
            soma = sum(r['nota'] for r in reviews_data)
            media = round(soma / len(reviews_data), 1)
            
        return {
            "items": reviews_data,
            "media_nota": media
        }

    async def get_my_reviews(self, user_id: int):
        return await self.review_repo.get_reviews_by_user(user_id)

    async def delete_review(self, user_id: int, review_id: int):
        review = await self.review_repo.get_by_id(review_id) 
        if not review:
            raise HTTPException(status_code=HTTPStatus.NOT_FOUND, detail="Avaliação não encontrada")

        if (review.id_user != user_id) :
            raise HTTPException(status_code=HTTPStatus.FORBIDDEN, detail="Acesso negado: Você não é o autor desta avaliação")

        await self.review_repo.delete_review_by_id(review_id)
        return {"message": "Avaliação deletada com sucesso"}
    
    async def get_weekly_ranking(self) -> list[dict]:
        return await self.review_repo.get_top_rated_games(limit=10)