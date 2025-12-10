from sqlalchemy import text, select, func, desc, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
from app.models.user import Avaliacao, Jogo 

class ReviewRepository:
    def __init__(self, session: AsyncSession):
        self.session = session


    async def _update_game_average(self, game_id: int):
        """
        Recalcula a média das avaliações de um jogo e atualiza a tabela Jogos.
        """

        stmt_avg = select(func.avg(Avaliacao.nota)).where(Avaliacao.id_jogo == game_id)
        result = await self.session.execute(stmt_avg)
        new_average = result.scalar() or 0.0

        stmt_update = (
            update(Jogo)
            .where(Jogo.id_jogo == game_id)
            .values(media_nota=round(new_average, 1))
        )
        await self.session.execute(stmt_update)

    async def create_review(self, review: Avaliacao) -> Avaliacao:
        stmt = text("""
            INSERT INTO avaliacoes (nota, comentario, id_jogo, id_user)
            VALUES (:nota, :comment, :jid, :uid)
            RETURNING id_avaliacao
        """)
        
        params = {
            "nota": review.nota,
            "comment": review.comentario,
            "jid": review.id_jogo,
            "uid": review.id_user
        }
        
        result = await self.session.execute(stmt, params)
        review.id_avaliacao = result.scalar()
        

        await self._update_game_average(review.id_jogo)
        
        await self.session.commit()
        return review

    async def update_review(self, review: Avaliacao) -> Avaliacao:

        await self._update_game_average(review.id_jogo)
        
        await self.session.commit()
        await self.session.refresh(review)
        return review

    async def delete_review_by_id(self, review_id: int):

        stmt_get = select(Avaliacao.id_jogo).where(Avaliacao.id_avaliacao == review_id)
        game_id = await self.session.scalar(stmt_get)


        stmt = text("DELETE FROM avaliacoes WHERE id_avaliacao = :id")
        await self.session.execute(stmt, {"id": review_id})
        

        if game_id:
            await self._update_game_average(game_id)

        await self.session.commit()


    async def get_reviews_by_game(self, game_id: int) -> list[dict]:
        stmt = text("""
            SELECT a.id_avaliacao, a.nota, a.comentario, a.id_jogo, a.id_user, u.username
            FROM avaliacoes a
            JOIN users u ON a.id_user = u.id
            WHERE a.id_jogo = :jid
        """)
        result = await self.session.execute(stmt, {"jid": game_id})
        reviews = []
        for row in result.mappings():
            reviews.append(dict(row))
        return reviews
    
    async def get_by_user_and_game(self, user_id: int, game_id: int) -> Avaliacao | None:
        stmt = select(Avaliacao).where(
            Avaliacao.id_user == user_id, 
            Avaliacao.id_jogo == game_id
        )
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_id(self, review_id: int) -> Avaliacao | None:
        stmt = select(Avaliacao).where(Avaliacao.id_avaliacao == review_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()
    
    async def get_reviews_by_user(self, user_id: int) -> list[Avaliacao]:
            stmt = (
                select(Avaliacao)
                .where(Avaliacao.id_user == user_id)
                .options(joinedload(Avaliacao.jogo))
            )
            result = await self.session.execute(stmt)
            return result.scalars().all()


    async def get_top_rated_games(self, limit: int = 10) -> list[dict]:
        """
        Retorna o Top 10 jogos baseados na coluna media_nota.
        """
        stmt = (
            select(
                Jogo, 
                func.count(Avaliacao.id_avaliacao).label("total_reviews")
            )
            .join(Avaliacao, Jogo.id_jogo == Avaliacao.id_jogo) 
            .options(
                selectinload(Jogo.generos),
                joinedload(Jogo.desenvolvedora), 
                joinedload(Jogo.publicadora)
            )
            .group_by(Jogo.id_jogo)
            .order_by(desc(Jogo.media_nota))
            .limit(limit)
        )

        result = await self.session.execute(stmt)
        
        ranking = []
        for row in result:
            jogo_obj = row.Jogo
            total_calc = row.total_reviews
            
            ranking.append({
                "id_jogo": jogo_obj.id_jogo,
                "titulo": jogo_obj.titulo,
                "capa_url": jogo_obj.capa_url,
                "generos": jogo_obj.generos,
                "media": jogo_obj.media_nota if jogo_obj.media_nota else 0.0, 
                "total_reviews": total_calc,
                "descricao": jogo_obj.descricao,
                "desenvolvedora": jogo_obj.desenvolvedora, 
                "publicadora": jogo_obj.publicadora
            })
            
        return ranking